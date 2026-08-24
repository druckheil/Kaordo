#![forbid(unsafe_code)]

use std::{
    error::Error,
    fmt,
    fs::{self, File, OpenOptions},
    io::{self, Cursor, Read, Seek, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use ciborium::value::Value;
use uuid::Uuid;

mod object;

pub use object::{ObjectSummary, WorkspaceDetail, WorkspaceObjectIssue};

const MANIFEST_KIND: &str = "kaordo.workspace-manifest";
const LEGACY_MANIFEST_KIND: &str = concat!("veri", "dimensio.workspace-manifest");
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MANIFEST_VERSION: u16 = 1;
const WORKSPACE_EXTENSION: &str = "vdw";
const CANVAS_DOCUMENT_FILE: &str = "canvas.json";
const MAX_CANVAS_DOCUMENT_BYTES: usize = 4 * 1024 * 1024;
const CANVAS_MEDIA_DIRECTORY: &str = "blobs";
const CANVAS_MEDIA_MAX_CHUNK_BYTES: u64 = 8 * 1024 * 1024;
const WORKSPACE_DIRECTORIES: [&str; 6] = [
    "objects",
    "schemas",
    "revisions",
    "blobs",
    "blobs/b3",
    ".kaordo",
];
const LEGACY_METADATA_DIRECTORY: &str = concat!(".", "veri", "dimensio");

/// A local Kaordo workspace.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Workspace {
    created_at_unix_ms: u64,
    durability_warning: Option<String>,
    id: Uuid,
    name: String,
    path: PathBuf,
}

impl Workspace {
    /// Creation time stored in the workspace manifest.
    #[must_use]
    pub const fn created_at_unix_ms(&self) -> u64 {
        self.created_at_unix_ms
    }

    /// Stable identifier written into the workspace manifest.
    #[must_use]
    pub const fn id(&self) -> Uuid {
        self.id
    }

    /// Human-readable name derived from the `.vdw` directory name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Absolute or caller-provided path of the workspace directory.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Warning emitted when the workspace was committed but its parent
    /// directory could not be synchronized.
    #[must_use]
    pub fn durability_warning(&self) -> Option<&str> {
        self.durability_warning.as_deref()
    }
}

/// Filesystem operations for a Kaordo workspace.
pub struct WorkspaceService;

/// A managed directory containing Kaordo workspaces.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceLibrary {
    root: PathBuf,
}

/// A non-fatal problem encountered while scanning a workspace library.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceLibraryIssue {
    message: String,
    path: PathBuf,
}

impl WorkspaceLibraryIssue {
    /// Human-readable reason the entry could not be loaded.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Path of the entry that could not be loaded.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Valid workspaces and non-fatal issues found during a library scan.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceLibraryScan {
    issues: Vec<WorkspaceLibraryIssue>,
    workspaces: Vec<Workspace>,
}

impl WorkspaceLibraryScan {
    /// Entries that looked like workspaces but could not be loaded.
    #[must_use]
    pub fn issues(&self) -> &[WorkspaceLibraryIssue] {
        &self.issues
    }

    /// Valid workspaces found in the library.
    #[must_use]
    pub fn workspaces(&self) -> &[Workspace] {
        &self.workspaces
    }

    /// Consumes the scan and returns its valid workspaces.
    #[must_use]
    pub fn into_workspaces(self) -> Vec<Workspace> {
        self.workspaces
    }
}

impl WorkspaceLibrary {
    /// Creates a library rooted at the supplied directory.
    #[must_use]
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The directory in which `.vdw` workspaces are stored.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Creates a workspace from a single portable name.
    ///
    /// The library directory is created when it does not yet exist. Names are
    /// validated before they are joined to the root, so callers cannot escape
    /// the managed directory with path components.
    ///
    /// # Errors
    ///
    /// Returns an error when the name is invalid, the library cannot be
    /// created, or the workspace already exists or cannot be written.
    pub fn create_named(&self, requested_name: &str) -> Result<Workspace, WorkspaceError> {
        let name = normalize_library_workspace_name(requested_name)?;
        self.ensure_root()?;

        WorkspaceService::create(self.root.join(format!("{name}.{WORKSPACE_EXTENSION}")))
    }

    /// Permanently removes one workspace selected by its manifest UUID.
    ///
    /// The workspace is first moved to a non-discoverable path inside the
    /// managed library, so it disappears atomically from subsequent scans.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace is unknown or cannot be removed.
    pub fn delete_workspace(&self, workspace_id: Uuid) -> Result<(), WorkspaceError> {
        let workspace = self.find_workspace(workspace_id)?;
        let deleting_path = self
            .root
            .join(format!(".kaordo-deleting-{}", Uuid::now_v7()));
        rename_without_replace(workspace.path(), &deleting_path).map_err(|source| {
            WorkspaceError::Io {
                action: "prepare the workspace for deletion",
                path: workspace.path().to_path_buf(),
                source,
            }
        })?;
        sync_directory(&self.root)?;
        if let Err(source) = fs::remove_dir_all(&deleting_path) {
            let _ = rename_without_replace(&deleting_path, workspace.path());
            return Err(WorkspaceError::Io {
                action: "delete the workspace directory",
                path: deleting_path,
                source,
            });
        }
        sync_directory(&self.root)
    }

    /// Scans the library and loads every valid `.vdw` workspace manifest.
    ///
    /// Malformed workspace entries are reported as non-fatal issues so one
    /// damaged directory cannot hide the rest of the user's library.
    ///
    /// # Errors
    ///
    /// Returns an error when the library directory cannot be created or read.
    pub fn list(&self) -> Result<WorkspaceLibraryScan, WorkspaceError> {
        self.ensure_root()?;
        let entries = fs::read_dir(&self.root).map_err(|source| WorkspaceError::Io {
            action: "read the workspace library",
            path: self.root.clone(),
            source,
        })?;
        let mut issues = Vec::new();
        let mut workspaces = Vec::new();

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    issues.push(WorkspaceLibraryIssue {
                        message: format!("Could not read a library entry: {error}"),
                        path: self.root.clone(),
                    });
                    continue;
                }
            };
            let path = entry.path();
            if !has_workspace_extension(&path) {
                continue;
            }
            match entry.file_type() {
                Ok(file_type) if file_type.is_dir() => {}
                Ok(_) => {
                    issues.push(WorkspaceLibraryIssue {
                        message: "A .vdw entry is not a workspace directory.".to_owned(),
                        path,
                    });
                    continue;
                }
                Err(error) => {
                    issues.push(WorkspaceLibraryIssue {
                        message: format!("Could not inspect the workspace entry: {error}"),
                        path,
                    });
                    continue;
                }
            }

            match load_workspace(&path) {
                Ok(workspace) => workspaces.push(workspace),
                Err(error) => issues.push(WorkspaceLibraryIssue {
                    message: error.to_string(),
                    path,
                }),
            }
        }

        workspaces.sort_by(|left, right| {
            right
                .created_at_unix_ms
                .cmp(&left.created_at_unix_ms)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
                .then_with(|| left.path.cmp(&right.path))
        });
        Ok(WorkspaceLibraryScan { issues, workspaces })
    }

    /// Loads the optional workspace-level canvas document.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace is unknown or the stored document
    /// is invalid, oversized, or unreadable.
    pub fn load_canvas_document(
        &self,
        workspace_id: Uuid,
    ) -> Result<Option<String>, WorkspaceError> {
        let workspace = self.find_workspace(workspace_id)?;
        let path = workspace.path().join(".kaordo").join(CANVAS_DOCUMENT_FILE);
        let mut file = match open_canvas_file(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(source) => {
                return Err(WorkspaceError::Io {
                    action: "open the workspace canvas document",
                    path,
                    source,
                });
            }
        };
        let metadata = file.metadata().map_err(|source| WorkspaceError::Io {
            action: "inspect the workspace canvas document",
            path: path.clone(),
            source,
        })?;
        if !metadata.file_type().is_file() || metadata.len() > MAX_CANVAS_DOCUMENT_BYTES as u64 {
            return Err(WorkspaceError::InvalidCanvasDocument(
                "The workspace canvas document is not a bounded regular file.".to_owned(),
            ));
        }
        let mut bytes = Vec::new();
        (&mut file)
            .take(MAX_CANVAS_DOCUMENT_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|source| WorkspaceError::Io {
                action: "read the workspace canvas document",
                path: path.clone(),
                source,
            })?;
        let document = String::from_utf8(bytes).map_err(|_| {
            WorkspaceError::InvalidCanvasDocument(
                "The workspace canvas document must be UTF-8 JSON.".to_owned(),
            )
        })?;
        validate_canvas_document(&document)?;
        Ok(Some(document))
    }

    /// Atomically saves the workspace-level canvas document.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace is unknown, the JSON envelope is
    /// unsupported, or the document cannot be committed.
    pub fn save_canvas_document(
        &self,
        workspace_id: Uuid,
        document: &str,
    ) -> Result<(), WorkspaceError> {
        validate_canvas_document(document)?;
        let workspace = self.find_workspace(workspace_id)?;
        let directory = workspace.path().join(".kaordo");
        let metadata = fs::symlink_metadata(&directory).map_err(|source| WorkspaceError::Io {
            action: "inspect the workspace metadata directory",
            path: directory.clone(),
            source,
        })?;
        if !metadata.file_type().is_dir() {
            return Err(WorkspaceError::InvalidCanvasDocument(
                "The workspace metadata directory is invalid.".to_owned(),
            ));
        }
        let destination = directory.join(CANVAS_DOCUMENT_FILE);
        let temporary = directory.join(format!(".canvas-{}.tmp", Uuid::now_v7()));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|source| WorkspaceError::Io {
                action: "create the temporary canvas document",
                path: temporary.clone(),
                source,
            })?;
        if let Err(source) = file
            .write_all(document.as_bytes())
            .and_then(|()| file.sync_all())
        {
            let _ = fs::remove_file(&temporary);
            return Err(WorkspaceError::Io {
                action: "write the temporary canvas document",
                path: temporary,
                source,
            });
        }
        drop(file);
        if let Err(source) = fs::rename(&temporary, &destination) {
            let _ = fs::remove_file(&temporary);
            return Err(WorkspaceError::Io {
                action: "commit the workspace canvas document",
                path: destination,
                source,
            });
        }
        sync_directory(&directory)?;
        Ok(())
    }

    /// Returns the size of a durable canvas media blob, if it exists.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace or media path cannot be inspected,
    /// or when the media path is not a regular file.
    pub fn canvas_media_size(
        &self,
        workspace_id: Uuid,
        media_id: Uuid,
    ) -> Result<Option<u64>, WorkspaceError> {
        let workspace = self.find_workspace(workspace_id)?;
        let path = canvas_media_path(&workspace, media_id);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(source) => {
                return Err(WorkspaceError::Io {
                    action: "inspect the canvas media",
                    path,
                    source,
                });
            }
        };
        if !metadata.file_type().is_file() {
            return Err(WorkspaceError::InvalidCanvasMedia(
                "Canvas media must be a regular file.".to_owned(),
            ));
        }
        Ok(Some(metadata.len()))
    }

    /// Reads one bounded range from a completed canvas media blob.
    ///
    /// # Errors
    ///
    /// Returns an error when the requested range is invalid, the workspace or
    /// media cannot be opened, or the file cannot be read.
    pub fn read_canvas_media_chunk(
        &self,
        workspace_id: Uuid,
        media_id: Uuid,
        offset: u64,
        length: u64,
    ) -> Result<Vec<u8>, WorkspaceError> {
        if length == 0 || length > CANVAS_MEDIA_MAX_CHUNK_BYTES {
            return Err(WorkspaceError::InvalidCanvasMedia(
                "Canvas media reads must be between 1 byte and 8 MiB.".to_owned(),
            ));
        }
        let workspace = self.find_workspace(workspace_id)?;
        let path = canvas_media_path(&workspace, media_id);
        let mut file = open_canvas_media_file(&path).map_err(|source| WorkspaceError::Io {
            action: "open the canvas media",
            path: path.clone(),
            source,
        })?;
        let metadata = file.metadata().map_err(|source| WorkspaceError::Io {
            action: "inspect the canvas media",
            path: path.clone(),
            source,
        })?;
        if !metadata.file_type().is_file() || offset > metadata.len() {
            return Err(WorkspaceError::InvalidCanvasMedia(
                "The canvas media range is outside the stored file.".to_owned(),
            ));
        }
        let amount = usize::try_from(length.min(metadata.len() - offset)).map_err(|_| {
            WorkspaceError::InvalidCanvasMedia("Canvas media range is too large.".to_owned())
        })?;
        file.seek(io::SeekFrom::Start(offset))
            .map_err(|source| WorkspaceError::Io {
                action: "seek in the canvas media",
                path: path.clone(),
                source,
            })?;
        let mut bytes = vec![0; amount];
        file.read_exact(&mut bytes)
            .map_err(|source| WorkspaceError::Io {
                action: "read the canvas media",
                path,
                source,
            })?;
        Ok(bytes)
    }

    /// Writes one resumable chunk and atomically publishes the blob at the
    /// final chunk. Incomplete files never appear as readable media.
    ///
    /// # Errors
    ///
    /// Returns an error when the chunk or declared range is invalid, the
    /// workspace cannot be opened, or the media cannot be written safely.
    pub fn write_canvas_media_chunk(
        &self,
        workspace_id: Uuid,
        media_id: Uuid,
        offset: u64,
        total: u64,
        bytes: &[u8],
    ) -> Result<(), WorkspaceError> {
        if total == 0 || bytes.is_empty() || bytes.len() as u64 > CANVAS_MEDIA_MAX_CHUNK_BYTES {
            return Err(WorkspaceError::InvalidCanvasMedia(
                "Canvas media chunks must be non-empty and no larger than 8 MiB.".to_owned(),
            ));
        }
        let end = offset.checked_add(bytes.len() as u64).ok_or_else(|| {
            WorkspaceError::InvalidCanvasMedia("Canvas media offset is too large.".to_owned())
        })?;
        if end > total {
            return Err(WorkspaceError::InvalidCanvasMedia(
                "Canvas media chunk exceeds the declared file size.".to_owned(),
            ));
        }
        let workspace = self.find_workspace(workspace_id)?;
        let directory = workspace.path().join(CANVAS_MEDIA_DIRECTORY);
        ensure_regular_directory(&directory)?;
        let destination = canvas_media_path(&workspace, media_id);
        let temporary = directory.join(format!(".media-{media_id}.part"));
        if let Ok(metadata) = fs::symlink_metadata(&temporary)
            && !metadata.file_type().is_file()
        {
            return Err(WorkspaceError::InvalidCanvasMedia(
                "The canvas media temporary file is invalid.".to_owned(),
            ));
        }
        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&temporary)
            .map_err(|source| WorkspaceError::Io {
                action: "open the temporary canvas media",
                path: temporary.clone(),
                source,
            })?;
        file.set_len(total).map_err(|source| WorkspaceError::Io {
            action: "size the temporary canvas media",
            path: temporary.clone(),
            source,
        })?;
        file.seek(io::SeekFrom::Start(offset))
            .map_err(|source| WorkspaceError::Io {
                action: "seek in the temporary canvas media",
                path: temporary.clone(),
                source,
            })?;
        file.write_all(bytes)
            .and_then(|()| {
                if end == total {
                    file.sync_all()
                } else {
                    Ok(())
                }
            })
            .map_err(|source| WorkspaceError::Io {
                action: "write the temporary canvas media",
                path: temporary.clone(),
                source,
            })?;
        drop(file);
        if end == total {
            fs::rename(&temporary, &destination).map_err(|source| WorkspaceError::Io {
                action: "commit the canvas media",
                path: destination,
                source,
            })?;
            sync_directory(&directory)?;
        }
        Ok(())
    }

    /// Deletes completed and incomplete canvas media. Missing files are fine.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace cannot be found or a media file
    /// cannot be removed.
    pub fn delete_canvas_media(
        &self,
        workspace_id: Uuid,
        media_id: Uuid,
    ) -> Result<(), WorkspaceError> {
        let workspace = self.find_workspace(workspace_id)?;
        let directory = workspace.path().join(CANVAS_MEDIA_DIRECTORY);
        for path in [
            canvas_media_path(&workspace, media_id),
            directory.join(format!(".media-{media_id}.part")),
        ] {
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(source) => {
                    return Err(WorkspaceError::Io {
                        action: "delete canvas media",
                        path,
                        source,
                    });
                }
            }
        }
        Ok(())
    }

    fn ensure_root(&self) -> Result<(), WorkspaceError> {
        fs::create_dir_all(&self.root).map_err(|source| WorkspaceError::Io {
            action: "create the workspace library",
            path: self.root.clone(),
            source,
        })
    }
}

fn validate_canvas_document(document: &str) -> Result<(), WorkspaceError> {
    if document.len() > MAX_CANVAS_DOCUMENT_BYTES {
        return Err(WorkspaceError::InvalidCanvasDocument(format!(
            "Workspace canvas documents must be {MAX_CANVAS_DOCUMENT_BYTES} bytes or fewer."
        )));
    }
    let value: serde_json::Value = serde_json::from_str(document).map_err(|_| {
        WorkspaceError::InvalidCanvasDocument(
            "The workspace canvas document must be valid JSON.".to_owned(),
        )
    })?;
    let valid = value.as_object().is_some_and(|object| {
        object.get("version").and_then(serde_json::Value::as_u64) == Some(1)
            && object
                .get("elements")
                .is_some_and(serde_json::Value::is_array)
    });
    if !valid {
        return Err(WorkspaceError::InvalidCanvasDocument(
            "The workspace canvas document schema is unsupported.".to_owned(),
        ));
    }
    Ok(())
}

fn canvas_media_path(workspace: &Workspace, media_id: Uuid) -> PathBuf {
    workspace
        .path()
        .join(CANVAS_MEDIA_DIRECTORY)
        .join(format!("media-{media_id}.blob"))
}

fn ensure_regular_directory(path: &Path) -> Result<(), WorkspaceError> {
    let metadata = fs::symlink_metadata(path).map_err(|source| WorkspaceError::Io {
        action: "inspect the canvas media directory",
        path: path.to_path_buf(),
        source,
    })?;
    if metadata.file_type().is_dir() {
        Ok(())
    } else {
        Err(WorkspaceError::InvalidCanvasMedia(
            "The canvas media directory is invalid.".to_owned(),
        ))
    }
}

fn open_canvas_media_file(path: &Path) -> io::Result<File> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        use rustix::fs::{Mode, OFlags, open};
        open(
            path,
            OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
        )
        .map(File::from)
        .map_err(Into::into)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        File::open(path)
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn open_canvas_file(path: &Path) -> io::Result<File> {
    use rustix::fs::{Mode, OFlags, open};

    open(
        path,
        OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
        Mode::empty(),
    )
    .map(File::from)
    .map_err(Into::into)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn open_canvas_file(path: &Path) -> io::Result<File> {
    File::open(path)
}

impl WorkspaceService {
    /// Creates a new `.vdw` directory and its minimal deterministic manifest.
    ///
    /// The workspace is assembled in a private sibling directory and renamed
    /// into place only after its manifest and directory structure are durable.
    ///
    /// # Errors
    ///
    /// Returns an error when the path is invalid, already exists, cannot be
    /// written, or the manifest cannot be encoded.
    pub fn create(requested_path: impl AsRef<Path>) -> Result<Workspace, WorkspaceError> {
        let workspace_path = normalize_workspace_path(requested_path.as_ref())?;
        let parent = workspace_path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));

        if !parent.is_dir() {
            return Err(WorkspaceError::InvalidPath(
                "The selected parent directory does not exist.".to_owned(),
            ));
        }

        if try_exists(&workspace_path, "check the workspace destination")? {
            return Err(WorkspaceError::AlreadyExists(workspace_path));
        }

        let name = workspace_name(&workspace_path)?;
        let id = Uuid::now_v7();
        let created_at_unix_ms = current_unix_millis()?;
        let manifest = ManifestData {
            id,
            name: name.clone(),
            created_at_unix_ms,
        };
        let manifest_bytes = encode_manifest(&manifest)?;

        let temporary_path = temporary_workspace_path(parent);
        fs::create_dir(&temporary_path).map_err(|source| WorkspaceError::Io {
            action: "create the temporary workspace directory",
            path: temporary_path.clone(),
            source,
        })?;
        let pending = PendingDirectory::new(temporary_path.clone());

        for relative_path in WORKSPACE_DIRECTORIES {
            let directory_path = temporary_path.join(relative_path);
            fs::create_dir_all(&directory_path).map_err(|source| WorkspaceError::Io {
                action: "create the workspace directory structure",
                path: directory_path,
                source,
            })?;
        }

        let manifest_path = temporary_path.join("manifest.vdm");
        let mut manifest_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&manifest_path)
            .map_err(|source| WorkspaceError::Io {
                action: "create the workspace manifest",
                path: manifest_path.clone(),
                source,
            })?;
        manifest_file
            .write_all(&manifest_bytes)
            .and_then(|()| manifest_file.sync_all())
            .map_err(|source| WorkspaceError::Io {
                action: "write the workspace manifest",
                path: manifest_path,
                source,
            })?;
        // Windows refuses to rename a directory while a contained file handle
        // is still open. Close the manifest before committing the directory.
        drop(manifest_file);

        for relative_path in WORKSPACE_DIRECTORIES.iter().rev() {
            sync_directory(&temporary_path.join(relative_path))?;
        }
        sync_directory(&temporary_path)?;
        commit_workspace(&temporary_path, &workspace_path)?;
        pending.commit();
        let durability_warning = sync_directory(parent).err().map(|error| {
            format!("The workspace was created, but durability could not be confirmed: {error}")
        });

        Ok(Workspace {
            created_at_unix_ms,
            durability_warning,
            id,
            name,
            path: workspace_path,
        })
    }
}

fn has_workspace_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(WORKSPACE_EXTENSION))
}

fn load_workspace(path: &Path) -> Result<Workspace, WorkspaceError> {
    migrate_legacy_metadata_directory(path)?;
    let manifest_path = path.join("manifest.vdm");
    let mut manifest_file =
        open_manifest_file(&manifest_path).map_err(|source| WorkspaceError::Io {
            action: "open the workspace manifest without following links",
            path: manifest_path.clone(),
            source,
        })?;
    let metadata = manifest_file
        .metadata()
        .map_err(|source| WorkspaceError::Io {
            action: "inspect the opened workspace manifest",
            path: manifest_path.clone(),
            source,
        })?;
    if !metadata.file_type().is_file() {
        return Err(invalid_manifest(
            &manifest_path,
            "The manifest is not a regular file.",
        ));
    }
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err(invalid_manifest(
            &manifest_path,
            "The manifest exceeds the supported size limit.",
        ));
    }

    let mut bytes = Vec::with_capacity(metadata.len().min(MAX_MANIFEST_BYTES) as usize);
    (&mut manifest_file)
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|source| WorkspaceError::Io {
            action: "read the workspace manifest",
            path: manifest_path.clone(),
            source,
        })?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(invalid_manifest(
            &manifest_path,
            "The manifest exceeds the supported size limit.",
        ));
    }
    let manifest = decode_manifest(&manifest_path, &bytes)?;
    let normalized_name = normalize_library_workspace_name(&manifest.name)
        .map_err(|error| invalid_manifest(&manifest_path, &error.to_string()))?;
    if normalized_name != manifest.name {
        return Err(invalid_manifest(
            &manifest_path,
            "The manifest contains a non-canonical workspace name.",
        ));
    }
    let directory_name = path.file_stem().and_then(|name| name.to_str());
    if directory_name != Some(manifest.name.as_str()) {
        return Err(invalid_manifest(
            &manifest_path,
            "The manifest name does not match the workspace directory.",
        ));
    }
    for relative_path in WORKSPACE_DIRECTORIES {
        let required_path = path.join(relative_path);
        let Ok(metadata) = fs::symlink_metadata(&required_path) else {
            return Err(invalid_manifest(
                &manifest_path,
                "The workspace directory structure is incomplete.",
            ));
        };
        if !metadata.file_type().is_dir() {
            return Err(invalid_manifest(
                &manifest_path,
                "The workspace directory structure is invalid.",
            ));
        }
    }

    Ok(Workspace {
        created_at_unix_ms: manifest.created_at_unix_ms,
        durability_warning: None,
        id: manifest.id,
        name: manifest.name,
        path: path.to_path_buf(),
    })
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn open_manifest_file(path: &Path) -> io::Result<File> {
    use rustix::fs::{Mode, OFlags, open};

    open(
        path,
        OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
        Mode::empty(),
    )
    .map(File::from)
    .map_err(Into::into)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn open_manifest_file(path: &Path) -> io::Result<File> {
    File::open(path)
}

fn decode_manifest(path: &Path, bytes: &[u8]) -> Result<ManifestData, WorkspaceError> {
    let mut cursor = Cursor::new(bytes);
    let value: Value = ciborium::de::from_reader(&mut cursor)
        .map_err(|error| invalid_manifest(path, &format!("Could not decode CBOR: {error}")))?;
    if cursor.position() != bytes.len() as u64 {
        return Err(invalid_manifest(
            path,
            "The manifest contains trailing data.",
        ));
    }
    let Value::Array(fields) = value else {
        return Err(invalid_manifest(path, "The manifest must be a CBOR array."));
    };
    let [kind, version, id, name, created_at] = fields.as_slice() else {
        return Err(invalid_manifest(
            path,
            "The manifest has an unexpected field count.",
        ));
    };

    if !matches_kind(kind, MANIFEST_KIND, LEGACY_MANIFEST_KIND) {
        return Err(invalid_manifest(path, "The manifest kind is unsupported."));
    }
    let Value::Integer(version) = version else {
        return Err(invalid_manifest(path, "The manifest version is invalid."));
    };
    let version = u16::try_from(*version)
        .map_err(|_| invalid_manifest(path, "The manifest version is invalid."))?;
    if version != MANIFEST_VERSION {
        return Err(invalid_manifest(
            path,
            "The manifest version is unsupported.",
        ));
    }
    let Value::Bytes(id) = id else {
        return Err(invalid_manifest(
            path,
            "The workspace identifier is invalid.",
        ));
    };
    let id = Uuid::from_slice(id)
        .map_err(|_| invalid_manifest(path, "The workspace identifier is invalid."))?;
    let Value::Text(name) = name else {
        return Err(invalid_manifest(path, "The workspace name is invalid."));
    };
    let Value::Integer(created_at) = created_at else {
        return Err(invalid_manifest(path, "The creation timestamp is invalid."));
    };
    let created_at_unix_ms = u64::try_from(*created_at)
        .map_err(|_| invalid_manifest(path, "The creation timestamp is invalid."))?;

    Ok(ManifestData {
        id,
        name: name.clone(),
        created_at_unix_ms,
    })
}

fn migrate_legacy_metadata_directory(workspace_path: &Path) -> Result<(), WorkspaceError> {
    let legacy = workspace_path.join(LEGACY_METADATA_DIRECTORY);
    let current = workspace_path.join(".kaordo");
    if !legacy.exists() {
        return Ok(());
    }
    if !current.exists() {
        return fs::rename(&legacy, &current).map_err(|source| WorkspaceError::Io {
            action: "migrate the workspace metadata directory to Kaordo",
            path: legacy,
            source,
        });
    }

    let legacy_canvas = legacy.join(CANVAS_DOCUMENT_FILE);
    let current_canvas = current.join(CANVAS_DOCUMENT_FILE);
    if legacy_canvas.exists() && !current_canvas.exists() {
        fs::rename(&legacy_canvas, &current_canvas).map_err(|source| WorkspaceError::Io {
            action: "migrate the workspace canvas document to Kaordo",
            path: legacy_canvas,
            source,
        })?;
    }
    if fs::read_dir(&legacy)
        .map_err(|source| WorkspaceError::Io {
            action: "inspect the legacy workspace metadata directory",
            path: legacy.clone(),
            source,
        })?
        .next()
        .is_none()
    {
        fs::remove_dir(&legacy).map_err(|source| WorkspaceError::Io {
            action: "remove the migrated workspace metadata directory",
            path: legacy,
            source,
        })?;
    }
    Ok(())
}

fn matches_kind(value: &Value, current: &str, legacy: &str) -> bool {
    matches!(value, Value::Text(kind) if kind == current || kind == legacy)
}

fn invalid_manifest(path: &Path, message: &str) -> WorkspaceError {
    WorkspaceError::InvalidManifest {
        message: message.to_owned(),
        path: path.to_path_buf(),
    }
}

fn normalize_library_workspace_name(requested_name: &str) -> Result<String, WorkspaceError> {
    if requested_name.trim() != requested_name {
        return Err(WorkspaceError::InvalidPath(
            "Workspace names cannot start or end with whitespace.".to_owned(),
        ));
    }

    let mut name = requested_name;
    while let Some((stem, _)) = name
        .rsplit_once('.')
        .filter(|(_, extension)| extension.eq_ignore_ascii_case(WORKSPACE_EXTENSION))
    {
        name = stem;
    }

    if name.is_empty() {
        return Err(WorkspaceError::InvalidPath(
            "Enter a workspace name.".to_owned(),
        ));
    }
    if matches!(name, "." | "..") {
        return Err(WorkspaceError::InvalidPath(
            "Choose a workspace name without path components.".to_owned(),
        ));
    }
    if name.ends_with('.') {
        return Err(WorkspaceError::InvalidPath(
            "Workspace names cannot end with a period.".to_owned(),
        ));
    }
    if name.len() > 200 {
        return Err(WorkspaceError::InvalidPath(
            "Workspace names must be 200 bytes or fewer.".to_owned(),
        ));
    }
    if name.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*'
            )
    }) {
        return Err(WorkspaceError::InvalidPath(
            "Workspace names cannot contain path separators or reserved filename characters."
                .to_owned(),
        ));
    }

    let portable_stem = name.split('.').next().unwrap_or(name);
    if is_reserved_windows_filename(portable_stem) {
        return Err(WorkspaceError::InvalidPath(
            "Choose a workspace name that is portable across operating systems.".to_owned(),
        ));
    }

    Ok(name.to_owned())
}

fn is_reserved_windows_filename(name: &str) -> bool {
    let uppercase = name.to_ascii_uppercase();
    matches!(uppercase.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || uppercase
            .strip_prefix("COM")
            .or_else(|| uppercase.strip_prefix("LPT"))
            .is_some_and(|number| {
                matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
}

/// Reports the format stability level used by the workspace layer.
#[must_use]
pub const fn format_status() -> &'static str {
    kaordo_core::FORMAT_STATUS
}

#[derive(Debug)]
pub enum WorkspaceError {
    InvalidPath(String),
    InvalidObjectTitle(String),
    InvalidObjectDocument(String),
    InvalidCanvasDocument(String),
    InvalidCanvasMedia(String),
    InvalidManifest {
        message: String,
        path: PathBuf,
    },
    InvalidObject {
        message: String,
        path: PathBuf,
    },
    AlreadyExists(PathBuf),
    AmbiguousWorkspaceId(Uuid),
    ObjectAlreadyExists(Uuid),
    ObjectNotFound(Uuid),
    WorkspaceNotFound(Uuid),
    Clock,
    Encode(String),
    Io {
        action: &'static str,
        path: PathBuf,
        source: io::Error,
    },
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPath(message)
            | Self::InvalidObjectTitle(message)
            | Self::InvalidObjectDocument(message)
            | Self::InvalidCanvasDocument(message)
            | Self::InvalidCanvasMedia(message) => formatter.write_str(message),
            Self::InvalidManifest { message, path } => {
                write!(
                    formatter,
                    "Invalid workspace manifest at {}: {message}",
                    path.display()
                )
            }
            Self::AlreadyExists(path) => {
                write!(
                    formatter,
                    "A workspace already exists at {}.",
                    path.display()
                )
            }
            Self::AmbiguousWorkspaceId(id) => {
                write!(
                    formatter,
                    "More than one workspace uses identifier {id}; resolve the duplicate manifests before opening it."
                )
            }
            Self::InvalidObject { message, path } => {
                write!(
                    formatter,
                    "Invalid knowledge object at {}: {message}",
                    path.display()
                )
            }
            Self::ObjectAlreadyExists(id) => {
                write!(
                    formatter,
                    "A knowledge object with identifier {id} already exists."
                )
            }
            Self::ObjectNotFound(id) => write!(formatter, "Object {id} could not be found."),
            Self::WorkspaceNotFound(id) => {
                write!(formatter, "Workspace {id} was not found in the library.")
            }
            Self::Clock => formatter.write_str("The system clock is before the Unix epoch."),
            Self::Encode(message) => {
                write!(formatter, "Could not encode workspace data: {message}")
            }
            Self::Io {
                action,
                path,
                source,
            } => write!(
                formatter,
                "Could not {action} at {}: {source}",
                path.display()
            ),
        }
    }
}

impl Error for WorkspaceError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            Self::InvalidPath(_)
            | Self::InvalidObjectTitle(_)
            | Self::InvalidObjectDocument(_)
            | Self::InvalidCanvasDocument(_)
            | Self::InvalidCanvasMedia(_)
            | Self::InvalidManifest { .. }
            | Self::InvalidObject { .. }
            | Self::AlreadyExists(_)
            | Self::AmbiguousWorkspaceId(_)
            | Self::ObjectAlreadyExists(_)
            | Self::ObjectNotFound(_)
            | Self::WorkspaceNotFound(_)
            | Self::Clock
            | Self::Encode(_) => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ManifestData {
    id: Uuid,
    name: String,
    created_at_unix_ms: u64,
}

fn normalize_workspace_path(requested_path: &Path) -> Result<PathBuf, WorkspaceError> {
    let file_name = requested_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| {
            WorkspaceError::InvalidPath("Choose a name for the new workspace.".to_owned())
        })?;

    if requested_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(WORKSPACE_EXTENSION))
    {
        return Ok(requested_path.to_path_buf());
    }

    let mut workspace_path = requested_path.to_path_buf();
    workspace_path.set_file_name(format!("{file_name}.{WORKSPACE_EXTENSION}"));
    Ok(workspace_path)
}

fn workspace_name(workspace_path: &Path) -> Result<String, WorkspaceError> {
    let name = workspace_path
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            WorkspaceError::InvalidPath("Choose a name for the new workspace.".to_owned())
        })?;
    if name.trim() != name {
        return Err(WorkspaceError::InvalidPath(
            "Workspace names cannot start or end with whitespace.".to_owned(),
        ));
    }
    Ok(name.to_owned())
}

fn temporary_workspace_path(parent: &Path) -> PathBuf {
    parent.join(format!(".kaordo-creating-{}", Uuid::now_v7()))
}

fn current_unix_millis() -> Result<u64, WorkspaceError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| WorkspaceError::Clock)?
        .as_millis();
    u64::try_from(millis).map_err(|_| WorkspaceError::Clock)
}

fn encode_manifest(manifest: &ManifestData) -> Result<Vec<u8>, WorkspaceError> {
    let value = Value::Array(vec![
        Value::Text(MANIFEST_KIND.to_owned()),
        Value::Integer(MANIFEST_VERSION.into()),
        Value::Bytes(manifest.id.as_bytes().to_vec()),
        Value::Text(manifest.name.clone()),
        Value::Integer(manifest.created_at_unix_ms.into()),
    ]);
    let mut bytes = Vec::new();
    ciborium::ser::into_writer(&value, &mut bytes)
        .map_err(|error| WorkspaceError::Encode(error.to_string()))?;
    Ok(bytes)
}

fn try_exists(path: &Path, action: &'static str) -> Result<bool, WorkspaceError> {
    path.try_exists().map_err(|source| WorkspaceError::Io {
        action,
        path: path.to_path_buf(),
        source,
    })
}

fn commit_workspace(temporary_path: &Path, workspace_path: &Path) -> Result<(), WorkspaceError> {
    rename_without_replace(temporary_path, workspace_path).map_err(|source| {
        if source.kind() == io::ErrorKind::AlreadyExists {
            WorkspaceError::AlreadyExists(workspace_path.to_path_buf())
        } else {
            WorkspaceError::Io {
                action: "commit the workspace directory without replacing existing data",
                path: workspace_path.to_path_buf(),
                source,
            }
        }
    })
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn rename_without_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use rustix::fs::{CWD, RenameFlags, renameat_with};

    renameat_with(CWD, source, CWD, destination, RenameFlags::NOREPLACE).map_err(Into::into)
}

#[cfg(windows)]
fn rename_without_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::fs::OpenOptionsExt;

    // std::fs::rename may replace an existing destination on Windows. Reserve a
    // destination-specific lock with create_new before checking and renaming.
    // DELETE_ON_CLOSE makes the lock recover automatically if the process exits.
    const FILE_FLAG_DELETE_ON_CLOSE: u32 = 0x0400_0000;

    let file_name = destination.file_name().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "destination has no file name")
    })?;
    let mut lock_name = file_name.to_os_string();
    lock_name.push(".kaordo-noreplace.lock");
    let lock_path = destination.with_file_name(lock_name);
    let lock = OpenOptions::new()
        .write(true)
        .create_new(true)
        .custom_flags(FILE_FLAG_DELETE_ON_CLOSE)
        .open(&lock_path)
        .map_err(|source| {
            if source.kind() == io::ErrorKind::AlreadyExists
                || lock_path.try_exists().unwrap_or(false)
            {
                io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "destination is being committed",
                )
            } else {
                source
            }
        })?;

    if destination.try_exists()? {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "destination already exists",
        ));
    }

    let result = fs::rename(source, destination);
    drop(lock);
    result
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn rename_without_replace(_source: &Path, _destination: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "exclusive workspace commit is not implemented for this platform",
    ))
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), WorkspaceError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|source| WorkspaceError::Io {
            action: "synchronize the workspace directory",
            path: path.to_path_buf(),
            source,
        })
}

#[cfg(not(unix))]
#[allow(clippy::unnecessary_wraps)]
fn sync_directory(_path: &Path) -> Result<(), WorkspaceError> {
    Ok(())
}

struct PendingDirectory {
    path: PathBuf,
    committed: bool,
}

impl PendingDirectory {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            committed: false,
        }
    }

    fn commit(mut self) {
        self.committed = true;
    }
}

impl Drop for PendingDirectory {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use ciborium::value::Value;
    use tempfile::tempdir;
    use uuid::Uuid;

    use super::{
        LEGACY_MANIFEST_KIND, LEGACY_METADATA_DIRECTORY, MANIFEST_KIND, MANIFEST_VERSION,
        ManifestData, WorkspaceError, WorkspaceLibrary, WorkspaceService, encode_manifest,
    };

    #[test]
    fn library_creates_its_root_and_a_named_workspace() {
        let parent = tempdir().expect("temporary directory should be available");
        let library_root = parent.path().join("Kaordo");
        let library = WorkspaceLibrary::new(library_root.clone());

        let workspace = library
            .create_named("Research.VDW")
            .expect("workspace should be created in the library");

        assert_eq!(library.root(), library_root);
        assert_eq!(workspace.name(), "Research");
        assert_eq!(workspace.path(), library.root().join("Research.vdw"));

        let restarted_library = WorkspaceLibrary::new(library_root);
        let scan = restarted_library
            .list()
            .expect("workspace should be rediscovered after restart");
        assert!(scan.issues().is_empty());
        assert_eq!(scan.workspaces().len(), 1);
        assert_eq!(scan.workspaces()[0].id(), workspace.id());
        assert_eq!(scan.workspaces()[0].name(), workspace.name());
        assert_eq!(scan.workspaces()[0].path(), workspace.path());
    }

    #[test]
    fn library_migrates_pre_kaordo_manifest_and_metadata() {
        let parent = tempdir().expect("temporary directory should be available");
        let library = WorkspaceLibrary::new(parent.path().join("Kaordo"));
        let workspace = library
            .create_named("Legacy")
            .expect("workspace should be created");
        let current_metadata = workspace.path().join(".kaordo");
        let legacy_metadata = workspace.path().join(LEGACY_METADATA_DIRECTORY);
        fs::rename(&current_metadata, &legacy_metadata).expect("legacy metadata should be staged");

        let manifest = Value::Array(vec![
            Value::Text(LEGACY_MANIFEST_KIND.to_owned()),
            Value::Integer(MANIFEST_VERSION.into()),
            Value::Bytes(workspace.id().as_bytes().to_vec()),
            Value::Text(workspace.name().to_owned()),
            Value::Integer(workspace.created_at_unix_ms().into()),
        ]);
        let mut bytes = Vec::new();
        ciborium::ser::into_writer(&manifest, &mut bytes).expect("legacy manifest should encode");
        fs::write(workspace.path().join("manifest.vdm"), bytes)
            .expect("legacy manifest should be written");

        let scan = library
            .list()
            .expect("legacy workspace should remain readable");
        assert_eq!(scan.workspaces().len(), 1);
        assert!(current_metadata.is_dir());
        assert!(!legacy_metadata.exists());
    }

    #[test]
    fn library_deletes_only_the_workspace_selected_by_uuid() {
        let parent = tempdir().expect("temporary directory should be available");
        let library = WorkspaceLibrary::new(parent.path().join("Kaordo"));
        let removed = library
            .create_named("Removed")
            .expect("workspace should exist");
        let retained = library
            .create_named("Retained")
            .expect("workspace should exist");

        library
            .delete_workspace(removed.id())
            .expect("selected workspace should be deleted");

        assert!(!removed.path().exists());
        assert!(retained.path().is_dir());
        let listed = library.list().expect("library should remain readable");
        assert_eq!(listed.workspaces(), &[retained]);
    }

    #[test]
    fn listing_creates_an_absent_library_root() {
        let parent = tempdir().expect("temporary directory should be available");
        let library_root = parent.path().join("Kaordo");
        let library = WorkspaceLibrary::new(library_root.clone());

        let scan = library.list().expect("empty library should be readable");

        assert!(library_root.is_dir());
        assert!(scan.workspaces().is_empty());
        assert!(scan.issues().is_empty());
    }

    #[test]
    fn canvas_document_survives_a_library_restart() {
        let parent = tempdir().expect("temporary directory should be available");
        let library_root = parent.path().join("Kaordo");
        let library = WorkspaceLibrary::new(library_root.clone());
        let workspace = library
            .create_named("Research")
            .expect("workspace should be created");
        let document = r##"{"elements":[{"fill":"#dcece5","height":90,"id":"rectangle-1","radius":10,"stroke":"#397565","strokeWidth":2,"type":"rectangle","width":140,"x":320,"y":240}],"version":1}"##;

        assert_eq!(
            library
                .load_canvas_document(workspace.id())
                .expect("missing document should be supported"),
            None
        );
        library
            .save_canvas_document(workspace.id(), document)
            .expect("canvas document should be saved");

        let restarted = WorkspaceLibrary::new(library_root);
        assert_eq!(
            restarted
                .load_canvas_document(workspace.id())
                .expect("canvas document should be reloaded"),
            Some(document.to_owned())
        );
    }

    #[test]
    fn canvas_document_rejects_invalid_json_envelopes() {
        let parent = tempdir().expect("temporary directory should be available");
        let library = WorkspaceLibrary::new(parent.path().join("Kaordo"));
        let workspace = library
            .create_named("Research")
            .expect("workspace should be created");

        for invalid in [
            "not json",
            r#"{"version":2,"elements":[]}"#,
            r#"{"version":1}"#,
        ] {
            let error = library
                .save_canvas_document(workspace.id(), invalid)
                .expect_err("unsupported canvas data should be rejected");
            assert!(matches!(error, WorkspaceError::InvalidCanvasDocument(_)));
        }
    }

    #[test]
    fn listing_keeps_valid_workspaces_when_other_entries_are_malformed() {
        let parent = tempdir().expect("temporary directory should be available");
        let library = WorkspaceLibrary::new(parent.path().join("Kaordo"));
        let valid = library
            .create_named("Valid")
            .expect("valid workspace should be created");
        let broken = library.root().join("Broken.vdw");
        fs::create_dir(&broken).expect("broken candidate should be created");
        fs::write(broken.join("manifest.vdm"), b"not cbor")
            .expect("broken manifest should be written");
        fs::write(library.root().join("NotDirectory.vdw"), b"not a directory")
            .expect("regular .vdw entry should be written");
        fs::write(library.root().join("notes.txt"), b"unrelated")
            .expect("unrelated entry should be written");

        let scan = library
            .list()
            .expect("malformed entries should not fail the whole scan");

        assert_eq!(scan.workspaces().len(), 1);
        assert_eq!(scan.workspaces()[0].id(), valid.id());
        assert_eq!(scan.issues().len(), 2);
    }

    #[test]
    fn listing_rejects_oversized_manifests() {
        let parent = tempdir().expect("temporary directory should be available");
        let library = WorkspaceLibrary::new(parent.path().join("Kaordo"));
        let oversized = library.root().join("Oversized.vdw");
        fs::create_dir_all(&oversized).expect("candidate should be created");
        fs::write(
            oversized.join("manifest.vdm"),
            vec![
                0_u8;
                usize::try_from(super::MAX_MANIFEST_BYTES)
                    .expect("manifest limit should fit usize")
                    + 1
            ],
        )
        .expect("oversized manifest should be written");

        let scan = library.list().expect("library should remain readable");

        assert!(scan.workspaces().is_empty());
        assert_eq!(scan.issues().len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn listing_does_not_follow_manifest_symlinks() {
        use std::os::unix::fs::symlink;

        let parent = tempdir().expect("temporary directory should be available");
        let library = WorkspaceLibrary::new(parent.path().join("Kaordo"));
        let candidate = library.root().join("Linked.vdw");
        fs::create_dir_all(&candidate).expect("candidate should be created");
        let external_manifest = parent.path().join("external-manifest.vdm");
        fs::write(&external_manifest, b"external").expect("external file should be written");
        symlink(&external_manifest, candidate.join("manifest.vdm"))
            .expect("manifest symlink should be created");

        let scan = library.list().expect("library should remain readable");

        assert!(scan.workspaces().is_empty());
        assert_eq!(scan.issues().len(), 1);
    }

    #[test]
    fn listing_sorts_workspaces_by_manifest_creation_time() {
        let parent = tempdir().expect("temporary directory should be available");
        let library = WorkspaceLibrary::new(parent.path().join("Kaordo"));
        let older = library
            .create_named("Older")
            .expect("older workspace should be created");
        let newer = library
            .create_named("Newer")
            .expect("newer workspace should be created");
        for (workspace, created_at_unix_ms) in [(&older, 1), (&newer, 2)] {
            let manifest = ManifestData {
                id: workspace.id(),
                name: workspace.name().to_owned(),
                created_at_unix_ms,
            };
            fs::write(
                workspace.path().join("manifest.vdm"),
                encode_manifest(&manifest).expect("manifest should encode"),
            )
            .expect("manifest timestamp should be rewritten");
        }

        let scan = library.list().expect("library should be readable");
        let names = scan
            .workspaces()
            .iter()
            .map(super::Workspace::name)
            .collect::<Vec<_>>();

        assert_eq!(names, ["Newer", "Older"]);
    }

    #[test]
    fn library_rejects_non_portable_names_before_creating_its_root() {
        let parent = tempdir().expect("temporary directory should be available");
        let library_root = parent.path().join("Kaordo");
        let library = WorkspaceLibrary::new(library_root.clone());

        for name in [
            "",
            " Research",
            "Research ",
            ".",
            "..",
            "../Escape",
            "Folder/Name",
            "Folder\\Name",
            "bad:name",
            "CON",
        ] {
            let error = library
                .create_named(name)
                .expect_err("unsafe workspace name should be rejected");
            assert!(matches!(error, WorkspaceError::InvalidPath(_)));
        }

        assert!(!library_root.exists());
    }

    #[test]
    fn creates_a_workspace_with_manifest_and_canonical_directories() {
        let parent = tempdir().expect("temporary directory should be available");
        let workspace = WorkspaceService::create(parent.path().join("Research"))
            .expect("workspace should be created");

        assert_eq!(workspace.name(), "Research");
        assert_eq!(workspace.path(), parent.path().join("Research.vdw"));
        assert!(workspace.path().join("manifest.vdm").is_file());
        for relative_path in ["objects", "schemas", "revisions", "blobs/b3", ".kaordo"] {
            assert!(workspace.path().join(relative_path).is_dir());
        }

        let manifest_bytes =
            fs::read(workspace.path().join("manifest.vdm")).expect("manifest should be readable");
        let manifest: Value =
            ciborium::de::from_reader(manifest_bytes.as_slice()).expect("manifest should be CBOR");
        let Value::Array(fields) = manifest else {
            panic!("manifest should use a deterministic array layout");
        };
        assert_eq!(fields[0], Value::Text(MANIFEST_KIND.to_owned()));
        assert_eq!(fields[1], Value::Integer(MANIFEST_VERSION.into()));
        assert_eq!(fields[2], Value::Bytes(workspace.id().as_bytes().to_vec()));
        assert_eq!(fields[3], Value::Text("Research".to_owned()));
    }

    #[test]
    fn refuses_to_replace_an_existing_workspace() {
        let parent = tempdir().expect("temporary directory should be available");
        let requested_path = parent.path().join("Research.vdw");
        WorkspaceService::create(&requested_path).expect("first creation should succeed");

        let error = WorkspaceService::create(&requested_path)
            .expect_err("second creation should not replace the workspace");
        assert!(matches!(error, WorkspaceError::AlreadyExists(_)));
    }

    #[test]
    fn refuses_to_replace_an_existing_empty_directory() {
        let parent = tempdir().expect("temporary directory should be available");
        let requested_path = parent.path().join("Research.vdw");
        fs::create_dir(&requested_path).expect("empty destination should be created");

        let error = WorkspaceService::create(&requested_path)
            .expect_err("creation should never replace an empty directory");
        assert!(matches!(error, WorkspaceError::AlreadyExists(_)));
        assert!(requested_path.is_dir());
    }

    #[test]
    fn concurrent_creation_commits_exactly_one_workspace() {
        use std::sync::{Arc, Barrier};

        let parent = tempdir().expect("temporary directory should be available");
        let requested_path = Arc::new(parent.path().join("Research.vdw"));
        let barrier = Arc::new(Barrier::new(2));
        let handles = (0..2)
            .map(|_| {
                let requested_path = Arc::clone(&requested_path);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    WorkspaceService::create(requested_path.as_ref())
                })
            })
            .collect::<Vec<_>>();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().expect("creator thread should finish"))
            .collect::<Vec<_>>();

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(WorkspaceError::AlreadyExists(_))))
                .count(),
            1
        );
    }

    #[test]
    fn manifest_encoding_is_deterministic() {
        let manifest = ManifestData {
            id: Uuid::from_u128(0x0198_0000_0000_7000_8000_0000_0000_0001),
            name: "Research".to_owned(),
            created_at_unix_ms: 1_786_000_000_000,
        };

        let encoded = encode_manifest(&manifest).expect("encoding should succeed");
        assert_eq!(
            encoded,
            encode_manifest(&manifest).expect("encoding should repeat")
        );
        assert_eq!(
            encoded,
            b"\x85\x78\x19kaordo.workspace-manifest\x01\x50\x01\x98\x00\x00\x00\x00\x70\x00\x80\x00\x00\x00\x00\x00\x00\x01\x68Research\x1b\x00\x00\x01\x9f\xd5\xe5\x44\x00"
        );
    }
}
