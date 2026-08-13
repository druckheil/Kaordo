use std::{
    fs::File,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
};

use ciborium::value::Value;
use uuid::{Uuid, Variant};

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
use super::sync_directory;
use super::{Workspace, WorkspaceError, WorkspaceLibrary, current_unix_millis};

const OBJECT_EXTENSION: &str = "vdo";
const OBJECT_KIND: &str = "kaordo.knowledge-object";
const LEGACY_OBJECT_KIND: &str = concat!("veri", "dimensio.knowledge-object");
const OBJECT_MAGIC: [u8; 4] = *b"VDO\0";
const OBJECT_VERSION: u16 = 1;
const OBJECT_HEADER_BYTES: usize = 8;
const SECTION_DESCRIPTOR_BYTES: usize = 48;
const MAX_SECTION_COUNT: u16 = 32;
const METADATA_SECTION_KIND: u16 = 1;
const METADATA_SECTION_VERSION: u16 = 1;
const SECTION_REQUIRED: u16 = 1;
#[cfg(test)]
const METADATA_SECTION_OFFSET: usize = OBJECT_HEADER_BYTES + SECTION_DESCRIPTOR_BYTES;
const DOCUMENT_SECTION_KIND: u16 = 2;
const DOCUMENT_SECTION_VERSION: u16 = 1;
const DOCUMENT_KIND: &str = "kaordo.object-document";
const LEGACY_DOCUMENT_KIND: &str = concat!("veri", "dimensio.object-document");
const MAX_DOCUMENT_BYTES: usize = 192 * 1024;
const MAX_OBJECT_BYTES: u64 = 256 * 1024;
const MAX_METADATA_BYTES: usize = 16 * 1024;
const MAX_OBJECT_TITLE_BYTES: usize = 200;

/// The lightweight metadata needed to display a knowledge object in the UI.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ObjectSummary {
    created_at_unix_ms: u64,
    durability_warning: Option<String>,
    id: Uuid,
    document_json: String,
    title: String,
}

impl ObjectSummary {
    /// Stable `UUIDv7` identifier stored in the object metadata.
    #[must_use]
    pub const fn id(&self) -> Uuid {
        self.id
    }

    /// Display title stored in the object metadata.
    #[must_use]
    pub fn title(&self) -> &str {
        &self.title
    }

    /// The versioned JSON document rendered by the object editor.
    #[must_use]
    pub fn document_json(&self) -> &str {
        &self.document_json
    }

    /// Creation time stored in the object metadata.
    #[must_use]
    pub const fn created_at_unix_ms(&self) -> u64 {
        self.created_at_unix_ms
    }

    /// Warning emitted when the object was committed but its shard directory
    /// could not be synchronized.
    #[must_use]
    pub fn durability_warning(&self) -> Option<&str> {
        self.durability_warning.as_deref()
    }
}

/// A non-fatal problem encountered while scanning a workspace's objects.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceObjectIssue {
    message: String,
    path: PathBuf,
}

impl WorkspaceObjectIssue {
    /// Human-readable reason the object could not be loaded.
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

/// A valid workspace together with its valid objects and non-fatal scan issues.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceDetail {
    issues: Vec<WorkspaceObjectIssue>,
    objects: Vec<ObjectSummary>,
    workspace: Workspace,
}

impl WorkspaceDetail {
    /// The opened workspace.
    #[must_use]
    pub const fn workspace(&self) -> &Workspace {
        &self.workspace
    }

    /// Valid knowledge objects, newest first.
    #[must_use]
    pub fn objects(&self) -> &[ObjectSummary] {
        &self.objects
    }

    /// Invalid object entries skipped during the scan.
    #[must_use]
    pub fn issues(&self) -> &[WorkspaceObjectIssue] {
        &self.issues
    }

    /// Consumes the detail into its owned components.
    #[must_use]
    pub fn into_parts(self) -> (Workspace, Vec<ObjectSummary>, Vec<WorkspaceObjectIssue>) {
        (self.workspace, self.objects, self.issues)
    }
}

impl WorkspaceLibrary {
    /// Opens a workspace by its stable manifest UUID and scans its objects.
    ///
    /// Invalid object files are returned as non-fatal issues, allowing valid
    /// objects in the same workspace to remain available.
    ///
    /// # Errors
    ///
    /// Returns an error when the library cannot be scanned or no valid
    /// workspace with the supplied identifier exists.
    pub fn open_workspace(&self, workspace_id: Uuid) -> Result<WorkspaceDetail, WorkspaceError> {
        let workspace = self.find_workspace(workspace_id)?;
        let (objects, issues) = scan_objects(self.root(), &workspace)?;
        Ok(WorkspaceDetail {
            issues,
            objects,
            workspace,
        })
    }

    /// Creates a basic knowledge object inside a workspace selected by UUID.
    ///
    /// The title is trimmed before storage. Duplicate titles are allowed;
    /// identity is provided by a newly generated `UUIDv7`.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace is unknown, the title is invalid,
    /// or the object cannot be encoded or committed atomically.
    pub fn create_object(
        &self,
        workspace_id: Uuid,
        requested_title: &str,
    ) -> Result<ObjectSummary, WorkspaceError> {
        let title = normalize_object_title(requested_title)?;
        let workspace = self.find_workspace(workspace_id)?;
        let mut object = ObjectSummary {
            created_at_unix_ms: current_unix_millis()?,
            durability_warning: None,
            id: Uuid::now_v7(),
            document_json: String::new(),
            title,
        };
        let bytes = encode_object(&object)?;
        object.durability_warning =
            write_object_atomically(self.root(), &workspace, object.id, &bytes)?;
        Ok(object)
    }

    /// Replaces an object's versioned editor document while preserving its identity.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace or object is unknown, the document
    /// exceeds the bounded object format, or the update cannot be committed.
    pub fn update_object_document(
        &self,
        workspace_id: Uuid,
        object_id: Uuid,
        document_json: &str,
    ) -> Result<ObjectSummary, WorkspaceError> {
        validate_document_json(document_json)?;
        let workspace = self.find_workspace(workspace_id)?;
        let (objects, _) = scan_objects(self.root(), &workspace)?;
        let mut object = objects
            .into_iter()
            .find(|object| object.id == object_id)
            .ok_or(WorkspaceError::ObjectNotFound(object_id))?;
        document_json.clone_into(&mut object.document_json);
        let bytes = encode_object(&object)?;
        object.durability_warning =
            replace_object_atomically(self.root(), &workspace, object.id, &bytes)?;
        Ok(object)
    }

    /// Permanently removes one knowledge object selected by UUID.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace or object is unknown, or when the
    /// verified object file cannot be removed durably.
    pub fn delete_object(&self, workspace_id: Uuid, object_id: Uuid) -> Result<(), WorkspaceError> {
        let workspace = self.find_workspace(workspace_id)?;
        let (objects, _) = scan_objects(self.root(), &workspace)?;
        if !objects.iter().any(|object| object.id == object_id) {
            return Err(WorkspaceError::ObjectNotFound(object_id));
        }

        #[cfg(any(target_os = "linux", target_os = "macos"))]
        return secure_store::delete(self.root(), &workspace, object_id);

        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            let destination = object_path(workspace.path(), object_id);
            let parent =
                destination
                    .parent()
                    .map(Path::to_path_buf)
                    .ok_or_else(|| WorkspaceError::Io {
                        action: "resolve the knowledge object directory",
                        path: destination.clone(),
                        source: io::Error::new(
                            io::ErrorKind::InvalidInput,
                            "object path has no parent",
                        ),
                    })?;
            let current = read_object(&destination)?;
            if current.id() != object_id {
                return Err(invalid_object(
                    &destination,
                    "The object identifier changed before deletion.",
                ));
            }
            fs::remove_file(&destination).map_err(|source| WorkspaceError::Io {
                action: "delete the knowledge object",
                path: destination,
                source,
            })?;
            sync_directory(&parent)
        }
    }

    pub(super) fn find_workspace(&self, workspace_id: Uuid) -> Result<Workspace, WorkspaceError> {
        let mut matching_workspaces = self
            .list()?
            .into_workspaces()
            .into_iter()
            .filter(|workspace| workspace.id() == workspace_id);
        let workspace = matching_workspaces
            .next()
            .ok_or(WorkspaceError::WorkspaceNotFound(workspace_id))?;
        if matching_workspaces.next().is_some() {
            return Err(WorkspaceError::AmbiguousWorkspaceId(workspace_id));
        }
        Ok(workspace)
    }
}

fn normalize_object_title(requested_title: &str) -> Result<String, WorkspaceError> {
    let title = requested_title.trim();
    if title.is_empty() {
        return Err(WorkspaceError::InvalidObjectTitle(
            "Enter an object title.".to_owned(),
        ));
    }
    if title.len() > MAX_OBJECT_TITLE_BYTES {
        return Err(WorkspaceError::InvalidObjectTitle(format!(
            "Object titles must be {MAX_OBJECT_TITLE_BYTES} bytes or fewer."
        )));
    }
    if title.chars().any(char::is_control) {
        return Err(WorkspaceError::InvalidObjectTitle(
            "Object titles cannot contain control characters.".to_owned(),
        ));
    }
    Ok(title.to_owned())
}

fn validate_document_json(document_json: &str) -> Result<(), WorkspaceError> {
    if document_json.len() > MAX_DOCUMENT_BYTES {
        return Err(WorkspaceError::InvalidObjectDocument(format!(
            "Object documents must be {MAX_DOCUMENT_BYTES} bytes or fewer."
        )));
    }
    if document_json.chars().any(|character| character == '\0') {
        return Err(WorkspaceError::InvalidObjectDocument(
            "Object documents cannot contain null characters.".to_owned(),
        ));
    }
    let value: serde_json::Value = serde_json::from_str(document_json).map_err(|_| {
        WorkspaceError::InvalidObjectDocument("The object document must be valid JSON.".to_owned())
    })?;
    let valid_envelope = value.as_object().is_some_and(|document| {
        document.get("version").and_then(serde_json::Value::as_u64) == Some(1)
            && document
                .get("elements")
                .is_some_and(serde_json::Value::is_array)
    });
    if !valid_envelope {
        return Err(WorkspaceError::InvalidObjectDocument(
            "The object document schema is unsupported.".to_owned(),
        ));
    }
    Ok(())
}

fn encode_object(object: &ObjectSummary) -> Result<Vec<u8>, WorkspaceError> {
    let metadata = Value::Array(vec![
        Value::Text(OBJECT_KIND.to_owned()),
        Value::Integer(OBJECT_VERSION.into()),
        Value::Bytes(object.id.as_bytes().to_vec()),
        Value::Text(object.title.clone()),
        Value::Integer(object.created_at_unix_ms.into()),
    ]);
    let mut metadata_bytes = Vec::new();
    ciborium::ser::into_writer(&metadata, &mut metadata_bytes)
        .map_err(|error| WorkspaceError::Encode(error.to_string()))?;
    let mut sections = vec![(
        METADATA_SECTION_KIND,
        METADATA_SECTION_VERSION,
        SECTION_REQUIRED,
        metadata_bytes,
    )];
    if !object.document_json.is_empty() {
        validate_document_json(&object.document_json)?;
        let document = Value::Array(vec![
            Value::Text(DOCUMENT_KIND.to_owned()),
            Value::Integer(DOCUMENT_SECTION_VERSION.into()),
            Value::Text(object.document_json.clone()),
        ]);
        let mut document_bytes = Vec::new();
        ciborium::ser::into_writer(&document, &mut document_bytes)
            .map_err(|error| WorkspaceError::Encode(error.to_string()))?;
        sections.push((
            DOCUMENT_SECTION_KIND,
            DOCUMENT_SECTION_VERSION,
            0,
            document_bytes,
        ));
    }

    let section_count = u16::try_from(sections.len())
        .map_err(|_| WorkspaceError::Encode("Too many object sections.".to_owned()))?;
    let table_end = OBJECT_HEADER_BYTES + sections.len() * SECTION_DESCRIPTOR_BYTES;
    let payload_bytes = sections
        .iter()
        .map(|section| section.3.len())
        .sum::<usize>();
    let mut bytes = Vec::with_capacity(table_end + payload_bytes);
    bytes.extend_from_slice(&OBJECT_MAGIC);
    bytes.extend_from_slice(&OBJECT_VERSION.to_be_bytes());
    bytes.extend_from_slice(&section_count.to_be_bytes());
    let mut payload_offset = table_end;
    for (kind, version, flags, payload) in &sections {
        bytes.extend_from_slice(&kind.to_be_bytes());
        bytes.extend_from_slice(&version.to_be_bytes());
        bytes.extend_from_slice(&flags.to_be_bytes());
        bytes.extend_from_slice(&0_u16.to_be_bytes());
        bytes.extend_from_slice(
            &u32::try_from(payload_offset)
                .map_err(|_| WorkspaceError::Encode("Object offset is too large.".to_owned()))?
                .to_be_bytes(),
        );
        bytes.extend_from_slice(
            &u32::try_from(payload.len())
                .map_err(|_| WorkspaceError::Encode("Object section is too large.".to_owned()))?
                .to_be_bytes(),
        );
        bytes.extend_from_slice(blake3::hash(payload).as_bytes());
        payload_offset += payload.len();
    }
    for (_, _, _, payload) in sections {
        bytes.extend_from_slice(&payload);
    }
    Ok(bytes)
}

fn decode_object(path: &Path, bytes: &[u8]) -> Result<ObjectSummary, WorkspaceError> {
    if bytes.len() < OBJECT_HEADER_BYTES {
        return Err(invalid_object(path, "The object file is truncated."));
    }
    if bytes[..4] != OBJECT_MAGIC {
        return Err(invalid_object(path, "The object magic is unsupported."));
    }
    let version = u16::from_be_bytes([bytes[4], bytes[5]]);
    if version != OBJECT_VERSION {
        return Err(invalid_object(path, "The object version is unsupported."));
    }
    let section_count = read_u16(bytes, 6);
    if section_count == 0 || section_count > MAX_SECTION_COUNT {
        return Err(invalid_object(
            path,
            "The object section count is invalid or exceeds the supported limit.",
        ));
    }
    let sections = parse_section_table(path, bytes, section_count)?;
    let mut metadata = None;
    let mut document = None;
    for section in sections {
        if section.kind == METADATA_SECTION_KIND {
            if metadata.is_some() {
                return Err(invalid_object(
                    path,
                    "The object contains more than one metadata section.",
                ));
            }
            if !section.required {
                return Err(invalid_object(
                    path,
                    "The metadata section must be marked as required.",
                ));
            }
            if section.version != METADATA_SECTION_VERSION {
                return Err(invalid_object(
                    path,
                    "The metadata section version is unsupported.",
                ));
            }
            if section.payload.len() > MAX_METADATA_BYTES {
                return Err(invalid_object(
                    path,
                    "The object metadata exceeds the supported size limit.",
                ));
            }
            metadata = Some(section.payload);
        } else if section.kind == DOCUMENT_SECTION_KIND {
            if document.is_some() {
                return Err(invalid_object(
                    path,
                    "The object contains more than one document section.",
                ));
            }
            if section.version != DOCUMENT_SECTION_VERSION {
                return Err(invalid_object(
                    path,
                    "The document section version is unsupported.",
                ));
            }
            if section.payload.len() > MAX_DOCUMENT_BYTES {
                return Err(invalid_object(
                    path,
                    "The object document exceeds the size limit.",
                ));
            }
            document = Some(section.payload);
        } else if section.required {
            return Err(invalid_object(
                path,
                "The object contains an unknown required section.",
            ));
        }
    }
    let metadata = metadata
        .ok_or_else(|| invalid_object(path, "The required metadata section is missing."))?;
    let mut object = decode_object_metadata(path, metadata)?;
    if let Some(document) = document {
        object.document_json = decode_object_document(path, document)?;
    }
    if object_path_from_objects_root(object.id) != relative_object_path(path) {
        return Err(invalid_object(
            path,
            "The object path does not match its identifier.",
        ));
    }
    Ok(object)
}

fn decode_object_document(path: &Path, bytes: &[u8]) -> Result<String, WorkspaceError> {
    let mut cursor = Cursor::new(bytes);
    let value: Value = ciborium::de::from_reader(&mut cursor).map_err(|error| {
        invalid_object(path, &format!("Could not decode document CBOR: {error}"))
    })?;
    if cursor.position() != bytes.len() as u64 {
        return Err(invalid_object(path, "The document contains trailing data."));
    }
    let mut canonical = Vec::new();
    ciborium::ser::into_writer(&value, &mut canonical).map_err(|error| {
        invalid_object(path, &format!("Could not re-encode document CBOR: {error}"))
    })?;
    if canonical != bytes {
        return Err(invalid_object(
            path,
            "The document is not deterministically encoded.",
        ));
    }
    let Value::Array(fields) = value else {
        return Err(invalid_object(path, "The document must be a CBOR array."));
    };
    let [kind, version, document] = fields.as_slice() else {
        return Err(invalid_object(
            path,
            "The document has an unexpected field count.",
        ));
    };
    if !super::matches_kind(kind, DOCUMENT_KIND, LEGACY_DOCUMENT_KIND) {
        return Err(invalid_object(path, "The document kind is unsupported."));
    }
    let Value::Integer(version) = version else {
        return Err(invalid_object(path, "The document version is invalid."));
    };
    if u16::try_from(*version).ok() != Some(DOCUMENT_SECTION_VERSION) {
        return Err(invalid_object(path, "The document version is unsupported."));
    }
    let Value::Text(document) = document else {
        return Err(invalid_object(path, "The object document is invalid."));
    };
    validate_document_json(document).map_err(|error| invalid_object(path, &error.to_string()))?;
    Ok(document.clone())
}

struct SectionDescriptor<'a> {
    kind: u16,
    payload: &'a [u8],
    required: bool,
    version: u16,
}

fn parse_section_table<'a>(
    path: &Path,
    bytes: &'a [u8],
    section_count: u16,
) -> Result<Vec<SectionDescriptor<'a>>, WorkspaceError> {
    let table_bytes = usize::from(section_count)
        .checked_mul(SECTION_DESCRIPTOR_BYTES)
        .ok_or_else(|| invalid_object(path, "The section table length is invalid."))?;
    let table_end = OBJECT_HEADER_BYTES
        .checked_add(table_bytes)
        .ok_or_else(|| invalid_object(path, "The section table length is invalid."))?;
    if table_end > bytes.len() {
        return Err(invalid_object(path, "The section table is truncated."));
    }

    let mut descriptors = Vec::with_capacity(usize::from(section_count));
    let mut ranges = Vec::with_capacity(usize::from(section_count));
    for index in 0..usize::from(section_count) {
        let descriptor_offset = OBJECT_HEADER_BYTES + index * SECTION_DESCRIPTOR_BYTES;
        let kind = read_u16(bytes, descriptor_offset);
        let version = read_u16(bytes, descriptor_offset + 2);
        let flags = read_u16(bytes, descriptor_offset + 4);
        if flags & !SECTION_REQUIRED != 0 || read_u16(bytes, descriptor_offset + 6) != 0 {
            return Err(invalid_object(
                path,
                "A section descriptor contains unsupported flags.",
            ));
        }
        let payload_offset = read_u32(bytes, descriptor_offset + 8) as usize;
        let payload_len = read_u32(bytes, descriptor_offset + 12) as usize;
        let payload_end = payload_offset
            .checked_add(payload_len)
            .ok_or_else(|| invalid_object(path, "A section length is invalid."))?;
        if payload_offset < table_end || payload_end > bytes.len() {
            return Err(invalid_object(
                path,
                "A section lies outside the object payload bounds.",
            ));
        }
        let checksum_start = descriptor_offset + 16;
        let checksum_end = checksum_start + 32;
        if bytes[checksum_start..checksum_end]
            != blake3::hash(&bytes[payload_offset..payload_end]).as_bytes()[..]
        {
            return Err(invalid_object(path, "A section checksum does not match."));
        }
        ranges.push((payload_offset, payload_end));
        descriptors.push(SectionDescriptor {
            kind,
            payload: &bytes[payload_offset..payload_end],
            required: flags & SECTION_REQUIRED != 0,
            version,
        });
    }
    ranges.sort_unstable();
    let mut expected_offset = table_end;
    for (start, end) in ranges {
        if start != expected_offset {
            return Err(invalid_object(
                path,
                "Object sections overlap or leave unreferenced data.",
            ));
        }
        expected_offset = end;
    }
    if expected_offset != bytes.len() {
        return Err(invalid_object(path, "The object contains trailing data."));
    }
    Ok(descriptors)
}

fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_be_bytes([bytes[offset], bytes[offset + 1]])
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn decode_object_metadata(
    path: &Path,
    metadata_bytes: &[u8],
) -> Result<ObjectSummary, WorkspaceError> {
    let mut cursor = Cursor::new(metadata_bytes);
    let value: Value = ciborium::de::from_reader(&mut cursor)
        .map_err(|error| invalid_object(path, &format!("Could not decode CBOR: {error}")))?;
    if cursor.position() != metadata_bytes.len() as u64 {
        return Err(invalid_object(path, "The metadata contains trailing data."));
    }
    let mut canonical_metadata = Vec::new();
    ciborium::ser::into_writer(&value, &mut canonical_metadata)
        .map_err(|error| invalid_object(path, &format!("Could not re-encode CBOR: {error}")))?;
    if canonical_metadata != metadata_bytes {
        return Err(invalid_object(
            path,
            "The metadata is not deterministically encoded.",
        ));
    }
    let Value::Array(fields) = value else {
        return Err(invalid_object(path, "The metadata must be a CBOR array."));
    };
    let [kind, metadata_version, id, title, created_at] = fields.as_slice() else {
        return Err(invalid_object(
            path,
            "The metadata has an unexpected field count.",
        ));
    };
    if !super::matches_kind(kind, OBJECT_KIND, LEGACY_OBJECT_KIND) {
        return Err(invalid_object(path, "The object kind is unsupported."));
    }
    let Value::Integer(metadata_version) = metadata_version else {
        return Err(invalid_object(path, "The metadata version is invalid."));
    };
    let metadata_version = u16::try_from(*metadata_version)
        .map_err(|_| invalid_object(path, "The metadata version is invalid."))?;
    if metadata_version != OBJECT_VERSION {
        return Err(invalid_object(path, "The metadata version is unsupported."));
    }
    let Value::Bytes(id) = id else {
        return Err(invalid_object(path, "The object identifier is invalid."));
    };
    let id = Uuid::from_slice(id)
        .map_err(|_| invalid_object(path, "The object identifier is invalid."))?;
    if id.get_version_num() != 7 || id.get_variant() != Variant::RFC4122 {
        return Err(invalid_object(
            path,
            "The object identifier must be an RFC-compatible UUIDv7.",
        ));
    }
    let Value::Text(title) = title else {
        return Err(invalid_object(path, "The object title is invalid."));
    };
    let normalized_title =
        normalize_object_title(title).map_err(|error| invalid_object(path, &error.to_string()))?;
    if normalized_title != *title {
        return Err(invalid_object(
            path,
            "The object title is not in canonical trimmed form.",
        ));
    }
    let Value::Integer(created_at) = created_at else {
        return Err(invalid_object(path, "The creation timestamp is invalid."));
    };
    let created_at_unix_ms = u64::try_from(*created_at)
        .map_err(|_| invalid_object(path, "The creation timestamp is invalid."))?;

    Ok(ObjectSummary {
        created_at_unix_ms,
        durability_warning: None,
        id,
        document_json: String::new(),
        title: title.clone(),
    })
}

fn scan_objects(
    library_root: &Path,
    workspace: &Workspace,
) -> Result<(Vec<ObjectSummary>, Vec<WorkspaceObjectIssue>), WorkspaceError> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    let (mut objects, mut issues) = secure_store::scan(library_root, workspace)?;
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let (mut objects, mut issues) = {
        let _ = library_root;
        scan_objects_by_path(workspace)?
    };

    objects.sort_by(|left, right| {
        right
            .created_at_unix_ms
            .cmp(&left.created_at_unix_ms)
            .then_with(|| right.id.cmp(&left.id))
            .then_with(|| left.title.cmp(&right.title))
    });
    issues.sort_by(|left, right| left.path.cmp(&right.path));
    Ok((objects, issues))
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn scan_objects_by_path(
    workspace: &Workspace,
) -> Result<(Vec<ObjectSummary>, Vec<WorkspaceObjectIssue>), WorkspaceError> {
    let objects_root = workspace.path().join("objects");
    ensure_real_directory(&objects_root, false)?;
    let mut candidates = Vec::new();
    let mut issues = Vec::new();
    scan_shard_level(&objects_root, 0, &mut candidates, &mut issues)?;

    let mut objects = Vec::new();
    for path in candidates {
        match read_object(&path) {
            Ok(object) => objects.push(object),
            Err(error) => issues.push(WorkspaceObjectIssue {
                message: error.to_string(),
                path,
            }),
        }
    }
    Ok((objects, issues))
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn scan_shard_level(
    directory: &Path,
    depth: u8,
    candidates: &mut Vec<PathBuf>,
    issues: &mut Vec<WorkspaceObjectIssue>,
) -> Result<(), WorkspaceError> {
    let entries = fs::read_dir(directory).map_err(|source| WorkspaceError::Io {
        action: "read the knowledge object directory",
        path: directory.to_path_buf(),
        source,
    })?;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                issues.push(WorkspaceObjectIssue {
                    message: format!("Could not read an object directory entry: {error}"),
                    path: directory.to_path_buf(),
                });
                continue;
            }
        };
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                issues.push(WorkspaceObjectIssue {
                    message: format!("Could not inspect an object entry: {error}"),
                    path,
                });
                continue;
            }
        };
        if depth < 2 {
            if file_type.is_dir() {
                if let Err(error) = scan_shard_level(&path, depth + 1, candidates, issues) {
                    issues.push(WorkspaceObjectIssue {
                        message: error.to_string(),
                        path,
                    });
                }
            } else if file_type.is_symlink() {
                issues.push(WorkspaceObjectIssue {
                    message: "Symbolic links are not allowed in the object store.".to_owned(),
                    path,
                });
            }
        } else if has_object_extension(&path) {
            if file_type.is_file() {
                candidates.push(path);
            } else {
                issues.push(WorkspaceObjectIssue {
                    message: "A .vdo entry is not a regular object file.".to_owned(),
                    path,
                });
            }
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn read_object(path: &Path) -> Result<ObjectSummary, WorkspaceError> {
    let file = File::open(path).map_err(|source| WorkspaceError::Io {
        action: "open the knowledge object without following links",
        path: path.to_path_buf(),
        source,
    })?;
    read_object_file(path, file)
}

fn read_object_file(path: &Path, mut file: File) -> Result<ObjectSummary, WorkspaceError> {
    let metadata = file.metadata().map_err(|source| WorkspaceError::Io {
        action: "inspect the opened knowledge object",
        path: path.to_path_buf(),
        source,
    })?;
    if !metadata.file_type().is_file() {
        return Err(invalid_object(path, "The object is not a regular file."));
    }
    if metadata.len() > MAX_OBJECT_BYTES {
        return Err(invalid_object(
            path,
            "The object exceeds the supported size limit.",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len().min(MAX_OBJECT_BYTES) as usize);
    (&mut file)
        .take(MAX_OBJECT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|source| WorkspaceError::Io {
            action: "read the knowledge object",
            path: path.to_path_buf(),
            source,
        })?;
    if bytes.len() as u64 > MAX_OBJECT_BYTES {
        return Err(invalid_object(
            path,
            "The object exceeds the supported size limit.",
        ));
    }
    decode_object(path, &bytes)
}

fn has_object_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(OBJECT_EXTENSION))
}

#[cfg(any(test, not(any(target_os = "linux", target_os = "macos"))))]
fn object_path(workspace_path: &Path, id: Uuid) -> PathBuf {
    workspace_path.join(object_path_from_objects_root(id))
}

fn object_path_from_objects_root(id: Uuid) -> PathBuf {
    let hash = blake3::hash(id.as_bytes()).to_hex().to_string();
    PathBuf::from("objects")
        .join(&hash[..2])
        .join(&hash[2..4])
        .join(format!("{hash}.{OBJECT_EXTENSION}"))
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn ensure_object_shard_directory(workspace_path: &Path, id: Uuid) -> Result<(), WorkspaceError> {
    let hash = blake3::hash(id.as_bytes()).to_hex().to_string();
    let objects_root = workspace_path.join("objects");
    ensure_real_directory(&objects_root, false)?;
    let first_shard = objects_root.join(&hash[..2]);
    ensure_real_directory(&first_shard, true)?;
    let second_shard = first_shard.join(&hash[2..4]);
    ensure_real_directory(&second_shard, true)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn ensure_real_directory(path: &Path, create: bool) -> Result<(), WorkspaceError> {
    if create {
        match fs::create_dir(path) {
            Ok(()) => {
                if let Some(parent) = path.parent() {
                    sync_directory(parent)?;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(source) => {
                return Err(WorkspaceError::Io {
                    action: "create the knowledge object shard directory",
                    path: path.to_path_buf(),
                    source,
                });
            }
        }
    }
    let metadata = fs::symlink_metadata(path).map_err(|source| WorkspaceError::Io {
        action: "inspect the knowledge object shard directory",
        path: path.to_path_buf(),
        source,
    })?;
    if !metadata.file_type().is_dir() {
        return Err(invalid_object(
            path,
            "Symbolic links and non-directory entries are not allowed in the object store.",
        ));
    }
    Ok(())
}

fn relative_object_path(path: &Path) -> PathBuf {
    let components = path.components().rev().take(4).collect::<Vec<_>>();
    components.into_iter().rev().collect()
}

fn write_object_atomically(
    library_root: &Path,
    workspace: &Workspace,
    id: Uuid,
    bytes: &[u8],
) -> Result<Option<String>, WorkspaceError> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    return secure_store::write(library_root, workspace, id, bytes);

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = library_root;
        ensure_object_shard_directory(workspace.path(), id)?;
        write_object_path_atomically(&object_path(workspace.path(), id), id, bytes)
    }
}

fn replace_object_atomically(
    library_root: &Path,
    workspace: &Workspace,
    id: Uuid,
    bytes: &[u8],
) -> Result<Option<String>, WorkspaceError> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    return secure_store::replace(library_root, workspace, id, bytes);

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = library_root;
        let destination = object_path(workspace.path(), id);
        let metadata = fs::symlink_metadata(&destination).map_err(|source| WorkspaceError::Io {
            action: "inspect the knowledge object before updating",
            path: destination.clone(),
            source,
        })?;
        if !metadata.file_type().is_file() {
            return Err(invalid_object(
                &destination,
                "The object is not a regular file.",
            ));
        }
        let parent =
            destination
                .parent()
                .map(Path::to_path_buf)
                .ok_or_else(|| WorkspaceError::Io {
                    action: "resolve the knowledge object directory",
                    path: destination.clone(),
                    source: io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "object path has no parent",
                    ),
                })?;
        let temporary_path = parent.join(format!(".kaordo-object-{}.tmp", Uuid::now_v7()));
        let mut temporary_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .map_err(|source| WorkspaceError::Io {
                action: "create the temporary knowledge object update",
                path: temporary_path.clone(),
                source,
            })?;
        let pending = PendingFile::new(temporary_path.clone());
        temporary_file
            .write_all(bytes)
            .and_then(|()| temporary_file.sync_all())
            .map_err(|source| WorkspaceError::Io {
                action: "write the temporary knowledge object update",
                path: temporary_path.clone(),
                source,
            })?;
        drop(temporary_file);
        fs::rename(&temporary_path, &destination).map_err(|source| WorkspaceError::Io {
            action: "commit the knowledge object update",
            path: destination,
            source,
        })?;
        pending.commit();
        let warning = sync_directory(&parent).err().map(|error| {
            format!("The object was updated, but durability could not be confirmed: {error}")
        });
        Ok(warning)
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn write_object_path_atomically(
    destination: &Path,
    id: Uuid,
    bytes: &[u8],
) -> Result<Option<String>, WorkspaceError> {
    let parent = destination.parent().ok_or_else(|| WorkspaceError::Io {
        action: "resolve the knowledge object directory",
        path: destination.to_path_buf(),
        source: io::Error::new(io::ErrorKind::InvalidInput, "object path has no parent"),
    })?;
    let temporary_path = parent.join(format!(".kaordo-object-{}.tmp", Uuid::now_v7()));
    let mut temporary_file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary_path)
        .map_err(|source| WorkspaceError::Io {
            action: "create the temporary knowledge object",
            path: temporary_path.clone(),
            source,
        })?;
    let pending = PendingFile::new(temporary_path.clone());
    temporary_file
        .write_all(bytes)
        .and_then(|()| temporary_file.sync_all())
        .map_err(|source| WorkspaceError::Io {
            action: "write the temporary knowledge object",
            path: temporary_path.clone(),
            source,
        })?;
    drop(temporary_file);
    super::rename_without_replace(&temporary_path, destination).map_err(|source| {
        if source.kind() == io::ErrorKind::AlreadyExists {
            WorkspaceError::ObjectAlreadyExists(id)
        } else {
            WorkspaceError::Io {
                action: "commit the knowledge object without replacing existing data",
                path: destination.to_path_buf(),
                source,
            }
        }
    })?;
    pending.commit();
    let durability_warning = sync_directory(parent).err().map(|error| {
        format!("The object was created, but durability could not be confirmed: {error}")
    });
    Ok(durability_warning)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod secure_store {
    use std::{
        ffi::{CStr, OsStr},
        fs::File,
        io::{Read, Write},
        os::{fd::OwnedFd, unix::ffi::OsStrExt},
        path::{Path, PathBuf},
    };

    use rustix::{
        fs::{
            AtFlags, Dir, FileType, Mode, OFlags, RenameFlags, fsync, mkdirat, open, openat,
            renameat_with, unlinkat,
        },
        io::Errno,
    };
    use uuid::Uuid;

    use super::super::{MAX_MANIFEST_BYTES, decode_manifest};
    use super::{
        ObjectSummary, Workspace, WorkspaceError, WorkspaceObjectIssue, has_object_extension,
        read_object_file,
    };

    const DIRECTORY_FLAGS: OFlags = OFlags::RDONLY
        .union(OFlags::DIRECTORY)
        .union(OFlags::CLOEXEC)
        .union(OFlags::NOFOLLOW);

    pub(super) fn scan(
        library_root: &Path,
        workspace: &Workspace,
    ) -> Result<(Vec<ObjectSummary>, Vec<WorkspaceObjectIssue>), WorkspaceError> {
        let workspace_fd = open_workspace_directory(library_root, workspace)?;
        let objects_path = workspace.path().join("objects");
        let objects_fd =
            openat(&workspace_fd, "objects", DIRECTORY_FLAGS, Mode::empty()).map_err(|error| {
                object_store_io("open the object store directory", &objects_path, error)
            })?;
        let mut objects = Vec::new();
        let mut issues = Vec::new();
        scan_level(&objects_fd, &objects_path, 0, &mut objects, &mut issues)?;
        Ok((objects, issues))
    }

    pub(super) fn write(
        library_root: &Path,
        workspace: &Workspace,
        id: Uuid,
        bytes: &[u8],
    ) -> Result<Option<String>, WorkspaceError> {
        let workspace_fd = open_workspace_directory(library_root, workspace)?;
        let objects_path = workspace.path().join("objects");
        let objects_fd =
            openat(&workspace_fd, "objects", DIRECTORY_FLAGS, Mode::empty()).map_err(|error| {
                object_store_io("open the object store directory", &objects_path, error)
            })?;
        let hash = blake3::hash(id.as_bytes()).to_hex().to_string();
        let first_path = objects_path.join(&hash[..2]);
        let first_fd = open_or_create_directory(&objects_fd, &hash[..2], &first_path)?;
        let second_path = first_path.join(&hash[2..4]);
        let second_fd = open_or_create_directory(&first_fd, &hash[2..4], &second_path)?;
        let file_name = format!("{hash}.{}", super::OBJECT_EXTENSION);
        let destination = second_path.join(&file_name);
        write_exclusive_at(&second_fd, &file_name, &destination, id, bytes)
    }

    pub(super) fn replace(
        library_root: &Path,
        workspace: &Workspace,
        id: Uuid,
        bytes: &[u8],
    ) -> Result<Option<String>, WorkspaceError> {
        let workspace_fd = open_workspace_directory(library_root, workspace)?;
        let objects_path = workspace.path().join("objects");
        let objects_fd =
            openat(&workspace_fd, "objects", DIRECTORY_FLAGS, Mode::empty()).map_err(|error| {
                object_store_io("open the object store directory", &objects_path, error)
            })?;
        let hash = blake3::hash(id.as_bytes()).to_hex().to_string();
        let first_path = objects_path.join(&hash[..2]);
        let first_fd = openat(&objects_fd, &hash[..2], DIRECTORY_FLAGS, Mode::empty())
            .map_err(|error| object_store_io("open the first object shard", &first_path, error))?;
        let second_path = first_path.join(&hash[2..4]);
        let second_fd =
            openat(&first_fd, &hash[2..4], DIRECTORY_FLAGS, Mode::empty()).map_err(|error| {
                object_store_io("open the second object shard", &second_path, error)
            })?;
        let file_name = format!("{hash}.{}", super::OBJECT_EXTENSION);
        let destination = second_path.join(&file_name);
        let current_fd = openat(
            &second_fd,
            &file_name,
            OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW | OFlags::NONBLOCK,
            Mode::empty(),
        )
        .map_err(|error| {
            object_store_io(
                "open the knowledge object before updating",
                &destination,
                error,
            )
        })?;
        let current = read_object_file(&destination, File::from(current_fd))?;
        if current.id() != id {
            return Err(super::invalid_object(
                &destination,
                "The object identifier changed before updating.",
            ));
        }
        write_replace_at(&second_fd, &file_name, &destination, bytes)
    }

    pub(super) fn delete(
        library_root: &Path,
        workspace: &Workspace,
        id: Uuid,
    ) -> Result<(), WorkspaceError> {
        let workspace_fd = open_workspace_directory(library_root, workspace)?;
        let objects_path = workspace.path().join("objects");
        let objects_fd =
            openat(&workspace_fd, "objects", DIRECTORY_FLAGS, Mode::empty()).map_err(|error| {
                object_store_io("open the object store directory", &objects_path, error)
            })?;
        let hash = blake3::hash(id.as_bytes()).to_hex().to_string();
        let first_path = objects_path.join(&hash[..2]);
        let first_fd = openat(&objects_fd, &hash[..2], DIRECTORY_FLAGS, Mode::empty())
            .map_err(|error| object_store_io("open the first object shard", &first_path, error))?;
        let second_path = first_path.join(&hash[2..4]);
        let second_fd =
            openat(&first_fd, &hash[2..4], DIRECTORY_FLAGS, Mode::empty()).map_err(|error| {
                object_store_io("open the second object shard", &second_path, error)
            })?;
        let file_name = format!("{hash}.{}", super::OBJECT_EXTENSION);
        let destination = second_path.join(&file_name);
        let current_fd = openat(
            &second_fd,
            &file_name,
            OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW | OFlags::NONBLOCK,
            Mode::empty(),
        )
        .map_err(|error| {
            object_store_io(
                "open the knowledge object before deletion",
                &destination,
                error,
            )
        })?;
        let current = read_object_file(&destination, File::from(current_fd))?;
        if current.id() != id {
            return Err(super::invalid_object(
                &destination,
                "The object identifier changed before deletion.",
            ));
        }
        unlinkat(&second_fd, &file_name, AtFlags::empty())
            .map_err(|error| object_store_io("delete the knowledge object", &destination, error))?;
        fsync(&second_fd).map_err(|error| {
            object_store_io("synchronize the object deletion", &second_path, error)
        })
    }

    fn open_workspace_directory(
        library_root: &Path,
        workspace: &Workspace,
    ) -> Result<OwnedFd, WorkspaceError> {
        let library_fd = open(library_root, DIRECTORY_FLAGS, Mode::empty()).map_err(|error| {
            object_store_io(
                "open the workspace library without following links",
                library_root,
                error,
            )
        })?;
        let workspace_name = workspace.path().file_name().ok_or_else(|| {
            WorkspaceError::InvalidPath("The workspace path has no directory name.".to_owned())
        })?;
        let workspace_fd = openat(&library_fd, workspace_name, DIRECTORY_FLAGS, Mode::empty())
            .map_err(|error| {
                object_store_io(
                    "open the workspace directory without following links",
                    workspace.path(),
                    error,
                )
            })?;
        validate_manifest(&workspace_fd, workspace)?;
        Ok(workspace_fd)
    }

    fn validate_manifest(
        workspace_fd: &OwnedFd,
        workspace: &Workspace,
    ) -> Result<(), WorkspaceError> {
        let manifest_path = workspace.path().join("manifest.vdm");
        let manifest_fd = openat(
            workspace_fd,
            "manifest.vdm",
            OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW | OFlags::NONBLOCK,
            Mode::empty(),
        )
        .map_err(|error| {
            object_store_io(
                "open the workspace manifest without following links",
                &manifest_path,
                error,
            )
        })?;
        let mut file = File::from(manifest_fd);
        let metadata = file.metadata().map_err(|source| WorkspaceError::Io {
            action: "inspect the workspace manifest",
            path: manifest_path.clone(),
            source,
        })?;
        if !metadata.file_type().is_file() || metadata.len() > MAX_MANIFEST_BYTES {
            return Err(WorkspaceError::InvalidManifest {
                message: "The manifest is not a bounded regular file.".to_owned(),
                path: manifest_path,
            });
        }
        let capacity =
            usize::try_from(metadata.len()).map_err(|_| WorkspaceError::InvalidManifest {
                message: "The manifest size cannot be represented on this platform.".to_owned(),
                path: manifest_path.clone(),
            })?;
        let mut bytes = Vec::with_capacity(capacity);
        (&mut file)
            .take(MAX_MANIFEST_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|source| WorkspaceError::Io {
                action: "read the workspace manifest",
                path: manifest_path.clone(),
                source,
            })?;
        if bytes.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(WorkspaceError::InvalidManifest {
                message: "The manifest exceeds the supported size limit.".to_owned(),
                path: manifest_path,
            });
        }
        let manifest = decode_manifest(&manifest_path, &bytes)?;
        if manifest.id != workspace.id() || manifest.name != workspace.name() {
            return Err(WorkspaceError::InvalidManifest {
                message: "The opened workspace no longer matches the requested identifier."
                    .to_owned(),
                path: manifest_path,
            });
        }
        Ok(())
    }

    fn scan_level(
        directory_fd: &OwnedFd,
        display_path: &Path,
        depth: u8,
        objects: &mut Vec<ObjectSummary>,
        issues: &mut Vec<WorkspaceObjectIssue>,
    ) -> Result<(), WorkspaceError> {
        let mut directory = Dir::read_from(directory_fd).map_err(|error| {
            object_store_io("read the object shard directory", display_path, error)
        })?;
        for result in &mut directory {
            let entry = match result {
                Ok(entry) => entry,
                Err(error) => {
                    issues.push(WorkspaceObjectIssue {
                        message: format!("Could not read an object directory entry: {error}"),
                        path: display_path.to_path_buf(),
                    });
                    continue;
                }
            };
            let name = entry.file_name();
            if matches!(name.to_bytes(), b"." | b"..") {
                continue;
            }
            let name_path = Path::new(OsStr::from_bytes(name.to_bytes()));
            let entry_path = display_path.join(name_path);
            if depth < 2 {
                match entry.file_type() {
                    FileType::Directory | FileType::Unknown => {
                        match openat(directory_fd, name, DIRECTORY_FLAGS, Mode::empty()) {
                            Ok(child_fd) => {
                                if let Err(error) =
                                    scan_level(&child_fd, &entry_path, depth + 1, objects, issues)
                                {
                                    issues.push(WorkspaceObjectIssue {
                                        message: error.to_string(),
                                        path: entry_path,
                                    });
                                }
                            }
                            Err(error) => issues.push(WorkspaceObjectIssue {
                                message: format!(
                                    "Could not safely open the object shard directory: {error}"
                                ),
                                path: entry_path,
                            }),
                        }
                    }
                    FileType::Symlink => issues.push(WorkspaceObjectIssue {
                        message: "Symbolic links are not allowed in the object store.".to_owned(),
                        path: entry_path,
                    }),
                    _ => {}
                }
            } else if has_object_extension(name_path) {
                read_entry(
                    directory_fd,
                    name,
                    &entry_path,
                    entry.file_type(),
                    objects,
                    issues,
                );
            }
        }
        Ok(())
    }

    fn read_entry(
        directory_fd: &OwnedFd,
        name: &CStr,
        path: &Path,
        file_type: FileType,
        objects: &mut Vec<ObjectSummary>,
        issues: &mut Vec<WorkspaceObjectIssue>,
    ) {
        if file_type == FileType::Symlink || file_type == FileType::Directory {
            issues.push(WorkspaceObjectIssue {
                message: "A .vdo entry is not a regular object file.".to_owned(),
                path: path.to_path_buf(),
            });
            return;
        }
        let file_fd = match openat(
            directory_fd,
            name,
            OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW | OFlags::NONBLOCK,
            Mode::empty(),
        ) {
            Ok(file) => file,
            Err(error) => {
                issues.push(WorkspaceObjectIssue {
                    message: format!("Could not safely open the knowledge object: {error}"),
                    path: path.to_path_buf(),
                });
                return;
            }
        };
        match read_object_file(path, File::from(file_fd)) {
            Ok(object) => objects.push(object),
            Err(error) => issues.push(WorkspaceObjectIssue {
                message: error.to_string(),
                path: path.to_path_buf(),
            }),
        }
    }

    fn open_or_create_directory(
        parent_fd: &OwnedFd,
        name: &str,
        path: &Path,
    ) -> Result<OwnedFd, WorkspaceError> {
        match openat(parent_fd, name, DIRECTORY_FLAGS, Mode::empty()) {
            Ok(directory) => return Ok(directory),
            Err(Errno::NOENT) => {}
            Err(error) => {
                return Err(object_store_io(
                    "open the object shard directory without following links",
                    path,
                    error,
                ));
            }
        }
        match mkdirat(parent_fd, name, Mode::RWXU) {
            Ok(()) | Err(Errno::EXIST) => {}
            Err(error) => {
                return Err(object_store_io(
                    "create the object shard directory",
                    path,
                    error,
                ));
            }
        }
        fsync(parent_fd)
            .map_err(|error| object_store_io("synchronize the object shard parent", path, error))?;
        openat(parent_fd, name, DIRECTORY_FLAGS, Mode::empty()).map_err(|error| {
            object_store_io(
                "open the new object shard directory without following links",
                path,
                error,
            )
        })
    }

    fn write_exclusive_at(
        directory_fd: &OwnedFd,
        file_name: &str,
        destination: &Path,
        id: Uuid,
        bytes: &[u8],
    ) -> Result<Option<String>, WorkspaceError> {
        let temporary_name = format!(".kaordo-object-{}.tmp", Uuid::now_v7());
        let temporary_path = destination.with_file_name(&temporary_name);
        let temporary_fd = openat(
            directory_fd,
            &temporary_name,
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|error| {
            object_store_io(
                "create the temporary knowledge object",
                &temporary_path,
                error,
            )
        })?;
        let commit_result = (|| {
            let mut temporary_file = File::from(temporary_fd);
            temporary_file
                .write_all(bytes)
                .and_then(|()| temporary_file.sync_all())
                .map_err(|source| WorkspaceError::Io {
                    action: "write the temporary knowledge object",
                    path: temporary_path.clone(),
                    source,
                })?;
            drop(temporary_file);
            renameat_with(
                directory_fd,
                &temporary_name,
                directory_fd,
                file_name,
                RenameFlags::NOREPLACE,
            )
            .map_err(|error| {
                if error == Errno::EXIST {
                    WorkspaceError::ObjectAlreadyExists(id)
                } else {
                    object_store_io(
                        "commit the knowledge object without replacing existing data",
                        destination,
                        error,
                    )
                }
            })
        })();
        if let Err(error) = commit_result {
            let _ = unlinkat(directory_fd, &temporary_name, AtFlags::empty());
            return Err(error);
        }
        let durability_warning = fsync(directory_fd).err().map(|error| {
            format!(
                "The object was created, but durability could not be confirmed at {}: {error}",
                destination.display()
            )
        });
        Ok(durability_warning)
    }

    fn write_replace_at(
        directory_fd: &OwnedFd,
        file_name: &str,
        destination: &Path,
        bytes: &[u8],
    ) -> Result<Option<String>, WorkspaceError> {
        let temporary_name = format!(".kaordo-object-{}.tmp", Uuid::now_v7());
        let temporary_path = destination.with_file_name(&temporary_name);
        let temporary_fd = openat(
            directory_fd,
            &temporary_name,
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|error| {
            object_store_io("create the temporary object update", &temporary_path, error)
        })?;
        let commit_result = (|| {
            let mut temporary_file = File::from(temporary_fd);
            temporary_file
                .write_all(bytes)
                .and_then(|()| temporary_file.sync_all())
                .map_err(|source| WorkspaceError::Io {
                    action: "write the temporary object update",
                    path: temporary_path.clone(),
                    source,
                })?;
            drop(temporary_file);
            renameat_with(
                directory_fd,
                &temporary_name,
                directory_fd,
                file_name,
                RenameFlags::empty(),
            )
            .map_err(|error| {
                object_store_io("commit the knowledge object update", destination, error)
            })
        })();
        if let Err(error) = commit_result {
            let _ = unlinkat(directory_fd, &temporary_name, AtFlags::empty());
            return Err(error);
        }
        let warning = fsync(directory_fd).err().map(|error| {
            format!(
                "The object was updated, but durability could not be confirmed at {}: {error}",
                destination.display()
            )
        });
        Ok(warning)
    }

    fn object_store_io(action: &'static str, path: &Path, error: Errno) -> WorkspaceError {
        WorkspaceError::Io {
            action,
            path: PathBuf::from(path),
            source: error.into(),
        }
    }
}

fn invalid_object(path: &Path, message: &str) -> WorkspaceError {
    WorkspaceError::InvalidObject {
        message: message.to_owned(),
        path: path.to_path_buf(),
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
struct PendingFile {
    path: PathBuf,
    committed: bool,
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
impl PendingFile {
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

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
impl Drop for PendingFile {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;
    use uuid::{Uuid, Version};

    use super::{
        MAX_OBJECT_BYTES, ObjectSummary, WorkspaceError, WorkspaceLibrary, decode_object,
        encode_object, object_path, write_object_atomically,
    };

    fn fixture() -> (tempfile::TempDir, WorkspaceLibrary, super::Workspace) {
        let parent = tempdir().expect("temporary directory should be available");
        let library = WorkspaceLibrary::new(parent.path().join("Kaordo"));
        let workspace = library
            .create_named("Research")
            .expect("workspace should be created");
        (parent, library, workspace)
    }

    fn replace_metadata(mut bytes: Vec<u8>, metadata: &[u8]) -> Vec<u8> {
        let metadata_len = u32::try_from(metadata.len()).expect("test metadata should fit u32");
        bytes[20..24].copy_from_slice(&metadata_len.to_be_bytes());
        bytes[24..super::METADATA_SECTION_OFFSET]
            .copy_from_slice(blake3::hash(metadata).as_bytes());
        bytes.truncate(super::METADATA_SECTION_OFFSET);
        bytes.extend_from_slice(metadata);
        bytes
    }

    fn with_unknown_section(encoded: &[u8], required: bool) -> Vec<u8> {
        let metadata = &encoded[super::METADATA_SECTION_OFFSET..];
        let unknown_payload = b"future-section";
        let table_end = super::OBJECT_HEADER_BYTES + 2 * super::SECTION_DESCRIPTOR_BYTES;
        let unknown_offset = table_end + metadata.len();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&super::OBJECT_MAGIC);
        bytes.extend_from_slice(&super::OBJECT_VERSION.to_be_bytes());
        bytes.extend_from_slice(&2_u16.to_be_bytes());
        for (kind, version, flags, offset, payload) in [
            (
                super::METADATA_SECTION_KIND,
                super::METADATA_SECTION_VERSION,
                super::SECTION_REQUIRED,
                table_end,
                metadata,
            ),
            (
                99,
                7,
                u16::from(required),
                unknown_offset,
                unknown_payload.as_slice(),
            ),
        ] {
            bytes.extend_from_slice(&kind.to_be_bytes());
            bytes.extend_from_slice(&version.to_be_bytes());
            bytes.extend_from_slice(&flags.to_be_bytes());
            bytes.extend_from_slice(&0_u16.to_be_bytes());
            bytes.extend_from_slice(
                &u32::try_from(offset)
                    .expect("test offset should fit u32")
                    .to_be_bytes(),
            );
            bytes.extend_from_slice(
                &u32::try_from(payload.len())
                    .expect("test length should fit u32")
                    .to_be_bytes(),
            );
            bytes.extend_from_slice(blake3::hash(payload).as_bytes());
        }
        bytes.extend_from_slice(metadata);
        bytes.extend_from_slice(unknown_payload);
        bytes
    }

    #[test]
    fn object_encoding_has_exact_golden_bytes_and_roundtrips() {
        let object = ObjectSummary {
            created_at_unix_ms: 1_786_000_000_000,
            durability_warning: None,
            id: Uuid::from_u128(0x0198_0000_0000_7000_8000_0000_0000_0001),
            document_json: String::new(),
            title: "First idea".to_owned(),
        };

        let encoded = encode_object(&object).expect("object should encode");
        assert_eq!(
            hex::encode(&encoded),
            "56444f00000100010001000100010000000000380000003f8d1e00a7f3d7f496da65ad36c84b878467aa4accb0b2b014e1a97d36f26a221785776b616f72646f2e6b6e6f776c656467652d6f626a6563740150019800000000700080000000000000016a466972737420696465611b0000019fd5e54400"
        );

        let path = super::object_path_from_objects_root(object.id);
        assert_eq!(
            path,
            std::path::PathBuf::from(
                "objects/7a/a6/7aa6c4d086afe482e2003704b1743c4eb47ed0fc98df57582b0fe23cdc6e74f4.vdo"
            )
        );
        assert_eq!(
            decode_object(&path, &encoded).expect("object should decode"),
            object
        );
    }

    #[test]
    fn creates_uuid_v7_object_and_rediscovers_it_after_restart() {
        let (parent, library, workspace) = fixture();

        let created = library
            .create_object(workspace.id(), "  First idea  ")
            .expect("object should be created");

        assert_eq!(created.id().get_version(), Some(Version::SortRand));
        assert_eq!(created.title(), "First idea");
        assert!(object_path(workspace.path(), created.id()).is_file());

        let restarted = WorkspaceLibrary::new(parent.path().join("Kaordo"));
        let detail = restarted
            .open_workspace(workspace.id())
            .expect("workspace should open after restart");
        assert!(detail.issues().is_empty());
        assert_eq!(detail.workspace().id(), workspace.id());
        assert_eq!(detail.objects(), [created]);
    }

    #[test]
    fn deletes_only_the_object_selected_by_uuid() {
        let (_parent, library, workspace) = fixture();
        let removed = library
            .create_object(workspace.id(), "Removed")
            .expect("object should be created");
        let retained = library
            .create_object(workspace.id(), "Retained")
            .expect("object should be created");

        library
            .delete_object(workspace.id(), removed.id())
            .expect("selected object should be deleted");

        let reopened = library
            .open_workspace(workspace.id())
            .expect("workspace should remain readable");
        assert_eq!(reopened.objects(), &[retained]);
    }

    #[test]
    fn updates_and_rediscovers_an_object_document_atomically() {
        let (parent, library, workspace) = fixture();
        let created = library
            .create_object(workspace.id(), "Editable")
            .expect("object should be created");
        let document = r#"{"version":1,"elements":[{"id":"text-1","type":"rich-text","html":"<p><strong>Hello</strong></p>"}]}"#;

        let updated = library
            .update_object_document(workspace.id(), created.id(), document)
            .expect("document update should be committed");
        assert_eq!(updated.id(), created.id());
        assert_eq!(updated.title(), created.title());
        assert_eq!(updated.document_json(), document);

        let restarted = WorkspaceLibrary::new(parent.path().join("Kaordo"));
        let reopened = restarted
            .open_workspace(workspace.id())
            .expect("updated object should reopen");
        assert_eq!(reopened.objects(), [updated]);
    }

    #[test]
    fn decoder_requires_the_fixed_metadata_section_descriptor() {
        let object = ObjectSummary {
            created_at_unix_ms: 1,
            durability_warning: None,
            id: Uuid::from_u128(0x0198_0000_0000_7000_8000_0000_0000_0004),
            document_json: String::new(),
            title: "Descriptor".to_owned(),
        };
        let path = super::object_path_from_objects_root(object.id());
        let encoded = encode_object(&object).expect("object should encode");
        let mutations = [
            (4, 2_u16),
            (6, 2_u16),
            (8, 2_u16),
            (10, 2_u16),
            (12, 0_u16),
            (14, 1_u16),
        ];
        for (offset, replacement) in mutations {
            let mut invalid = encoded.clone();
            invalid[offset..offset + 2].copy_from_slice(&replacement.to_be_bytes());
            assert!(
                decode_object(&path, &invalid).is_err(),
                "descriptor field at byte {offset} must be validated"
            );
        }
        let mut invalid_offset = encoded.clone();
        invalid_offset[16..20].copy_from_slice(&57_u32.to_be_bytes());
        assert!(decode_object(&path, &invalid_offset).is_err());
        let mut invalid_length = encoded;
        let length = u32::from_be_bytes(
            invalid_length[20..24]
                .try_into()
                .expect("metadata length should have four bytes"),
        );
        invalid_length[20..24].copy_from_slice(&(length + 1).to_be_bytes());
        assert!(decode_object(&path, &invalid_length).is_err());
    }

    #[test]
    fn decoder_skips_unknown_optional_sections_and_rejects_required_ones() {
        let object = ObjectSummary {
            created_at_unix_ms: 1,
            durability_warning: None,
            id: Uuid::from_u128(0x0198_0000_0000_7000_8000_0000_0000_0007),
            document_json: String::new(),
            title: "Extensible".to_owned(),
        };
        let encoded = encode_object(&object).expect("object should encode");
        let path = super::object_path_from_objects_root(object.id());

        assert_eq!(
            decode_object(&path, &with_unknown_section(&encoded, false))
                .expect("unknown optional section should be skipped"),
            object
        );
        let error = decode_object(&path, &with_unknown_section(&encoded, true))
            .expect_err("unknown required section should be rejected");
        assert!(error.to_string().contains("unknown required section"));
    }

    #[test]
    fn decoder_rejects_noncanonical_cbor_and_non_rfc_uuid_variant() {
        let object = ObjectSummary {
            created_at_unix_ms: 1,
            durability_warning: None,
            id: Uuid::from_u128(0x0198_0000_0000_7000_8000_0000_0000_0005),
            document_json: String::new(),
            title: "Canonical".to_owned(),
        };
        let canonical = encode_object(&object).expect("object should encode");
        let mut metadata = canonical[super::METADATA_SECTION_OFFSET..].to_vec();
        let schema_version_offset = 1 + 1 + super::OBJECT_KIND.len();
        assert_eq!(metadata[schema_version_offset], 1);
        metadata.insert(schema_version_offset, 0x18);
        let noncanonical = replace_metadata(canonical, &metadata);
        let path = super::object_path_from_objects_root(object.id());
        let error = decode_object(&path, &noncanonical)
            .expect_err("non-preferred CBOR encoding should be rejected");
        assert!(error.to_string().contains("deterministically encoded"));

        let non_rfc = ObjectSummary {
            created_at_unix_ms: 1,
            durability_warning: None,
            id: Uuid::from_u128(0x0198_0000_0000_7000_0000_0000_0000_0006),
            document_json: String::new(),
            title: "Wrong variant".to_owned(),
        };
        let non_rfc_path = super::object_path_from_objects_root(non_rfc.id());
        let error = decode_object(
            &non_rfc_path,
            &encode_object(&non_rfc).expect("fixture should encode"),
        )
        .expect_err("non-RFC variant should be rejected");
        assert!(error.to_string().contains("RFC-compatible UUIDv7"));
    }

    #[test]
    fn duplicate_titles_are_allowed_and_newest_objects_sort_first() {
        let (_parent, library, workspace) = fixture();
        let first = library
            .create_object(workspace.id(), "Same title")
            .expect("first object should be created");
        let second = library
            .create_object(workspace.id(), "Same title")
            .expect("duplicate title should be allowed");

        let detail = library
            .open_workspace(workspace.id())
            .expect("workspace should open");

        assert_eq!(detail.objects().len(), 2);
        assert_eq!(detail.objects()[0].title(), "Same title");
        assert_eq!(detail.objects()[1].title(), "Same title");
        let expected_first = if second.created_at_unix_ms() > first.created_at_unix_ms()
            || (second.created_at_unix_ms() == first.created_at_unix_ms()
                && second.id() > first.id())
        {
            second.id()
        } else {
            first.id()
        };
        assert_eq!(detail.objects()[0].id(), expected_first);
    }

    #[test]
    fn scan_has_a_deterministic_newest_first_order() {
        let (_parent, library, workspace) = fixture();
        let older = ObjectSummary {
            created_at_unix_ms: 10,
            durability_warning: None,
            id: Uuid::from_u128(0x0198_0000_0000_7000_8000_0000_0000_0010),
            document_json: String::new(),
            title: "Older".to_owned(),
        };
        let newer = ObjectSummary {
            created_at_unix_ms: 20,
            durability_warning: None,
            id: Uuid::from_u128(0x0198_0000_0000_7000_8000_0000_0000_0020),
            document_json: String::new(),
            title: "Newer".to_owned(),
        };
        for object in [&older, &newer] {
            write_object_atomically(
                library.root(),
                &workspace,
                object.id(),
                &encode_object(object).expect("object should encode"),
            )
            .expect("object should be written");
        }

        let first_scan = library
            .open_workspace(workspace.id())
            .expect("workspace should open");
        let second_scan = library
            .open_workspace(workspace.id())
            .expect("workspace should open repeatedly");

        assert_eq!(first_scan.objects(), [newer, older]);
        assert_eq!(second_scan.objects(), first_scan.objects());
    }

    #[test]
    fn rejects_invalid_titles_without_writing_objects() {
        let (_parent, library, workspace) = fixture();

        let exact_limit = "é".repeat(100);
        let accepted = library
            .create_object(workspace.id(), &exact_limit)
            .expect("a 200-byte Unicode title should be accepted");
        assert_eq!(accepted.title(), exact_limit);

        for title in ["", "   ", "line\nbreak", &"é".repeat(101)] {
            let error = library
                .create_object(workspace.id(), title)
                .expect_err("invalid title should be rejected");
            assert!(matches!(error, WorkspaceError::InvalidObjectTitle(_)));
        }

        let detail = library
            .open_workspace(workspace.id())
            .expect("workspace should remain readable");
        assert_eq!(detail.objects(), [accepted]);
    }

    #[test]
    fn corrupt_objects_are_skipped_while_valid_objects_remain() {
        let (_parent, library, workspace) = fixture();
        let valid = library
            .create_object(workspace.id(), "Valid")
            .expect("valid object should be created");
        let truncated = library
            .create_object(workspace.id(), "Truncated")
            .expect("object should be created");
        let bad_checksum = library
            .create_object(workspace.id(), "Bad checksum")
            .expect("object should be created");
        let oversized = library
            .create_object(workspace.id(), "Oversized")
            .expect("object should be created");

        fs::write(object_path(workspace.path(), truncated.id()), b"VDO")
            .expect("object should be truncated");
        let checksum_path = object_path(workspace.path(), bad_checksum.id());
        let mut checksum_bytes = fs::read(&checksum_path).expect("object should be readable");
        let last = checksum_bytes
            .last_mut()
            .expect("encoded object should have a checksum");
        *last ^= 0xff;
        fs::write(checksum_path, checksum_bytes).expect("checksum should be damaged");
        fs::write(
            object_path(workspace.path(), oversized.id()),
            vec![0_u8; usize::try_from(MAX_OBJECT_BYTES).expect("limit should fit usize") + 1],
        )
        .expect("object should be oversized");

        let detail = library
            .open_workspace(workspace.id())
            .expect("corrupt objects should not fail the workspace scan");

        assert_eq!(detail.objects(), [valid]);
        assert_eq!(detail.issues().len(), 3);
        assert!(detail.issues().iter().all(|issue| issue.path().exists()));
        let messages = detail
            .issues()
            .iter()
            .map(super::WorkspaceObjectIssue::message)
            .collect::<Vec<_>>()
            .join(" ");
        assert!(messages.contains("truncated"));
        assert!(messages.contains("checksum"));
        assert!(messages.contains("size limit"));
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn object_scan_rejects_symlinks_without_hiding_valid_objects() {
        use std::os::unix::fs::symlink;

        let (parent, library, workspace) = fixture();
        let valid = library
            .create_object(workspace.id(), "Valid")
            .expect("valid object should be created");
        let linked = ObjectSummary {
            created_at_unix_ms: 1,
            durability_warning: None,
            id: Uuid::from_u128(0x0198_0000_0000_7000_8000_0000_0000_0002),
            document_json: String::new(),
            title: "Linked".to_owned(),
        };
        let external = parent.path().join("external.vdo");
        fs::write(
            &external,
            encode_object(&linked).expect("linked object should encode"),
        )
        .expect("external object should be written");
        let linked_path = object_path(workspace.path(), linked.id());
        fs::create_dir_all(linked_path.parent().expect("object should have a parent"))
            .expect("shards should be created");
        symlink(&external, &linked_path).expect("object symlink should be created");

        let detail = library
            .open_workspace(workspace.id())
            .expect("workspace should remain readable");

        assert_eq!(detail.objects(), [valid]);
        assert_eq!(detail.issues().len(), 1);
        assert_eq!(detail.issues()[0].path(), linked_path);
        assert!(detail.issues()[0].message().contains("not a regular"));
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn object_scan_rejects_a_symlinked_objects_root() {
        use std::os::unix::fs::symlink;

        let (parent, library, workspace) = fixture();
        let objects_root = workspace.path().join("objects");
        fs::remove_dir(&objects_root).expect("empty object root should be removable");
        let external = parent.path().join("external-objects");
        fs::create_dir(&external).expect("external directory should be created");
        symlink(&external, &objects_root).expect("object root symlink should be created");

        let error = super::scan_objects(library.root(), &workspace)
            .expect_err("the scanner must not traverse a symlinked object root");

        let rejected_path = match error {
            WorkspaceError::InvalidObject { path, .. } | WorkspaceError::Io { path, .. } => path,
            other => panic!("unexpected symlink rejection error: {other}"),
        };
        assert_eq!(rejected_path, objects_root);
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn object_writer_rejects_a_symlinked_shard_ancestor() {
        use std::os::unix::fs::symlink;

        let (parent, library, workspace) = fixture();
        let object = ObjectSummary {
            created_at_unix_ms: 1,
            durability_warning: None,
            id: Uuid::from_u128(0x0198_0000_0000_7000_8000_0000_0000_0008),
            document_json: String::new(),
            title: "Contained".to_owned(),
        };
        let destination = object_path(workspace.path(), object.id());
        let second_shard = destination
            .parent()
            .expect("object path should have a second shard");
        fs::create_dir_all(
            second_shard
                .parent()
                .expect("second shard should have a first shard"),
        )
        .expect("first shard should be created");
        let external = parent.path().join("external-shard");
        fs::create_dir(&external).expect("external shard should be created");
        symlink(&external, second_shard).expect("second shard symlink should be created");

        write_object_atomically(
            library.root(),
            &workspace,
            object.id(),
            &encode_object(&object).expect("object should encode"),
        )
        .expect_err("the writer must not traverse a symlinked shard");

        assert!(
            fs::read_dir(external)
                .expect("external shard should remain readable")
                .next()
                .is_none(),
            "no temporary or final object may escape the workspace"
        );
    }

    #[test]
    fn atomic_writer_never_replaces_an_existing_object() {
        let (_parent, library, workspace) = fixture();
        let object = ObjectSummary {
            created_at_unix_ms: 1,
            durability_warning: None,
            id: Uuid::from_u128(0x0198_0000_0000_7000_8000_0000_0000_0003),
            document_json: String::new(),
            title: "Original".to_owned(),
        };
        let destination = object_path(workspace.path(), object.id());
        fs::create_dir_all(destination.parent().expect("object should have a parent"))
            .expect("shards should be created");
        let original = encode_object(&object).expect("object should encode");
        write_object_atomically(library.root(), &workspace, object.id(), &original)
            .expect("first commit should succeed");

        let error =
            write_object_atomically(library.root(), &workspace, object.id(), b"replacement")
                .expect_err("second commit should not replace the object");

        assert!(matches!(error, WorkspaceError::ObjectAlreadyExists(id) if id == object.id()));
        assert_eq!(
            fs::read(destination).expect("object should remain readable"),
            original
        );
    }

    #[test]
    fn duplicate_workspace_identifiers_are_rejected() {
        let (_parent, library, original) = fixture();
        let duplicate = library
            .create_named("Duplicate")
            .expect("second workspace should be created");
        let duplicate_manifest = super::super::ManifestData {
            created_at_unix_ms: duplicate.created_at_unix_ms(),
            id: original.id(),
            name: duplicate.name().to_owned(),
        };
        fs::write(
            duplicate.path().join("manifest.vdm"),
            super::super::encode_manifest(&duplicate_manifest)
                .expect("duplicate manifest should encode"),
        )
        .expect("duplicate manifest should be written");

        let open_error = library
            .open_workspace(original.id())
            .expect_err("an ambiguous workspace identifier must not open");
        let create_error = library
            .create_object(original.id(), "Unsafe target")
            .expect_err("an object must not be written to an ambiguous workspace");

        assert!(matches!(
            open_error,
            WorkspaceError::AmbiguousWorkspaceId(id) if id == original.id()
        ));
        assert!(matches!(
            create_error,
            WorkspaceError::AmbiguousWorkspaceId(id) if id == original.id()
        ));
    }

    #[test]
    fn opening_and_creating_reject_unknown_workspace_ids() {
        let (_parent, library, _workspace) = fixture();
        let unknown = Uuid::from_u128(0x0198_0000_0000_7000_8000_0000_0000_00ff);

        let open_error = library
            .open_workspace(unknown)
            .expect_err("unknown workspace should not open");
        let create_error = library
            .create_object(unknown, "Orphan")
            .expect_err("object should not be created outside a workspace");

        assert!(matches!(open_error, WorkspaceError::WorkspaceNotFound(id) if id == unknown));
        assert!(matches!(create_error, WorkspaceError::WorkspaceNotFound(id) if id == unknown));
    }
}
