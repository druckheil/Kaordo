use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const TUS_VERSION: &str = "1.0.0";
pub const MAX_FLUO_ATTACHMENTS: usize = 4;
pub const MAX_LIGO_ATTACHMENTS: usize = 12;
pub const MAX_POST_BODY: usize = 500;
pub const MAX_LIGO_BODY: usize = 16_000;
pub const MAX_RONDO_BODY: usize = 4_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Space {
    Private,
    Public,
}

impl Space {
    pub fn segment(self) -> &'static str {
        match self {
            Self::Private => "private",
            Self::Public => "public",
        }
    }
}

#[derive(Debug, Clone)]
pub struct NodeStorage {
    private: SpaceStorage,
    public: SpaceStorage,
}

#[derive(Debug, Clone)]
pub struct SpaceStorage {
    root: PathBuf,
    quota_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRecord {
    pub complete: bool,
    pub created_at: i64,
    pub id: String,
    pub length: u64,
    pub metadata: String,
    pub offset: u64,
    pub updated_at: i64,
    pub created_by: Option<String>,
    pub public_reservation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub kind: String,
    pub mime_type: String,
    pub name: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Post {
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_reservation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeAttachment {
    pub id: String,
    pub mime_type: String,
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    pub attachments: Vec<EnvelopeAttachment>,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub id: String,
    pub recipient: String,
    pub sender: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RondoMessage {
    pub author: String,
    pub body: String,
    pub created_at: i64,
    pub id: String,
}

#[derive(Debug, Clone)]
pub struct StoredRondoMessage {
    pub space_id: String,
    pub room_id: String,
    pub message: RondoMessage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageItem {
    pub completed: bool,
    pub created_at: i64,
    pub deletable: bool,
    pub id: String,
    pub kind: String,
    pub name: String,
    pub owner: String,
    pub size_bytes: u64,
    pub storage_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

impl NodeStorage {
    pub fn open(root: &Path, public_quota: u64, private_quota: u64) -> io::Result<Self> {
        fs::create_dir_all(root)?;
        let private = SpaceStorage::open(&root.join("private"), private_quota)?;
        let public = SpaceStorage::open(&root.join("public"), public_quota)?;
        Ok(Self { private, public })
    }

    pub fn space(&self, space: Space) -> &SpaceStorage {
        match space {
            Space::Private => &self.private,
            Space::Public => &self.public,
        }
    }

    pub fn space_mut(&mut self, space: Space) -> &mut SpaceStorage {
        match space {
            Space::Private => &mut self.private,
            Space::Public => &mut self.public,
        }
    }

    pub fn set_quotas(&mut self, public: u64, private: u64) -> io::Result<()> {
        if public < self.public.used_bytes()? || private < self.private.used_bytes()? {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Space quota cannot be smaller than stored data.",
            ));
        }
        self.public.quota_bytes = public;
        self.private.quota_bytes = private;
        Ok(())
    }

    pub fn used_bytes(&self) -> io::Result<u64> {
        Ok(self
            .private
            .used_bytes()?
            .saturating_add(self.public.used_bytes()?))
    }

    pub fn clear(&self) -> io::Result<ClearResult> {
        Ok(ClearResult {
            private: self.private.clear()?,
            public: self.public.clear()?,
        })
    }

    pub fn storage_items(
        &self,
        space: Space,
        actor: &str,
        owner: bool,
    ) -> io::Result<Vec<StorageItem>> {
        self.space(space).storage_items(actor, owner)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearResult {
    pub private: SpaceClearResult,
    pub public: SpaceClearResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceClearResult {
    pub deleted_bytes: u64,
    pub deleted_uploads: usize,
    pub deleted_posts: usize,
}

impl SpaceStorage {
    fn open(root: &Path, quota_bytes: u64) -> io::Result<Self> {
        for directory in [
            "files",
            "records",
            "fluo-posts",
            "rondo-spaces",
            "ligo-envelopes",
        ] {
            fs::create_dir_all(root.join(directory))?;
        }
        Ok(Self {
            root: root.to_owned(),
            quota_bytes,
        })
    }

    pub fn used_bytes(&self) -> io::Result<u64> {
        tree_bytes(&self.root)
    }

    pub fn upload_count(&self) -> io::Result<usize> {
        Ok(self.records()?.len())
    }

    pub fn create_upload(
        &self,
        length: u64,
        metadata: String,
        owner: &str,
        reservation_id: Option<&str>,
        reservation_bytes: Option<u64>,
    ) -> Result<UploadRecord, StorageError> {
        if metadata.len() > 8_192 || metadata.bytes().any(|byte| byte == b'\r' || byte == b'\n') {
            return Err(StorageError::Invalid("Upload metadata is invalid."));
        }
        if let (Some(id), Some(bytes)) = (reservation_id, reservation_bytes) {
            let reserved = self
                .records()?
                .into_iter()
                .filter(|record| record.public_reservation_id.as_deref() == Some(id))
                .map(|record| record.length)
                .sum::<u64>();
            if reserved.saturating_add(length) > bytes {
                return Err(StorageError::Quota);
            }
        }
        if self.reserved_bytes()?.saturating_add(length) > self.quota_bytes {
            return Err(StorageError::Quota);
        }
        let now = now_millis();
        let record = UploadRecord {
            complete: length == 0,
            created_at: now,
            id: Uuid::new_v4().to_string(),
            length,
            metadata,
            offset: 0,
            updated_at: now,
            created_by: Some(owner.to_owned()),
            public_reservation_id: reservation_id.map(str::to_owned),
        };
        let data = self.data_path(&record.id);
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&data)
            .map_err(|_| StorageError::Invalid("Upload could not be created."))?;
        if let Err(error) = self.write_record(&record) {
            let _ = fs::remove_file(data);
            return Err(StorageError::Io(error));
        }
        Ok(record)
    }

    pub fn record(&self, id: &str) -> io::Result<Option<UploadRecord>> {
        if !valid_id(id) {
            return Ok(None);
        }
        let path = self.record_path(id);
        if !path.is_file() {
            return Ok(None);
        }
        Ok(read_json(&path).ok())
    }

    pub fn append_upload(
        &self,
        id: &str,
        expected_offset: u64,
        content_length: u64,
        input: &mut dyn Read,
        actor: &str,
        owner: bool,
    ) -> Result<UploadRecord, StorageError> {
        let current = self.record(id)?.ok_or(StorageError::Missing)?;
        if !owner && current.created_by.as_deref() != Some(actor) {
            return Err(StorageError::Forbidden);
        }
        if current.complete {
            return Err(StorageError::Offset(current.offset));
        }
        if expected_offset != current.offset
            || content_length > current.length.saturating_sub(current.offset)
        {
            return Err(StorageError::Offset(current.offset));
        }
        let mut file = OpenOptions::new()
            .write(true)
            .open(self.data_path(id))
            .map_err(StorageError::Io)?;
        file.seek(SeekFrom::Start(current.offset))
            .map_err(StorageError::Io)?;
        let mut remaining = content_length;
        let mut buffer = [0_u8; 64 * 1024];
        while remaining > 0 {
            let chunk_size = remaining.min(buffer.len() as u64) as usize;
            let read = input
                .read(&mut buffer[..chunk_size])
                .map_err(StorageError::Io)?;
            if read == 0 {
                return Err(StorageError::Invalid("Upload chunk is incomplete."));
            }
            file.write_all(&buffer[..read]).map_err(StorageError::Io)?;
            remaining -= read as u64;
        }
        file.flush().map_err(StorageError::Io)?;
        let next_offset = file
            .metadata()
            .map_err(StorageError::Io)?
            .len()
            .min(current.length);
        let next = UploadRecord {
            offset: next_offset,
            complete: next_offset == current.length,
            updated_at: now_millis(),
            ..current
        };
        self.write_record(&next).map_err(StorageError::Io)?;
        Ok(next)
    }

    pub fn delete_upload(
        &self,
        id: &str,
        actor: &str,
        owner: bool,
    ) -> Result<Option<String>, StorageError> {
        let record = self.record(id)?.ok_or(StorageError::Missing)?;
        if !owner && record.created_by.as_deref() != Some(actor) {
            return Err(StorageError::Forbidden);
        }
        let reservation = record.public_reservation_id.clone();
        let data_ok = remove_if_exists(self.data_path(id)).map_err(StorageError::Io)?;
        let record_ok = remove_if_exists(self.record_path(id)).map_err(StorageError::Io)?;
        if !(data_ok && record_ok) {
            return Err(StorageError::Missing);
        }
        Ok(reservation)
    }

    pub fn completed_file(&self, id: &str) -> io::Result<Option<(UploadRecord, PathBuf)>> {
        let Some(record) = self.record(id)? else {
            return Ok(None);
        };
        if !record.complete {
            return Ok(None);
        }
        let path = self.data_path(id);
        if !path.is_file() {
            return Ok(None);
        }
        Ok(Some((record, path)))
    }

    pub fn records(&self) -> io::Result<Vec<UploadRecord>> {
        let mut records = fs::read_dir(self.root.join("records"))?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("json")
            })
            .filter_map(|entry| read_json(&entry.path()).ok())
            .collect::<Vec<UploadRecord>>();
        records.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        Ok(records)
    }

    pub fn cleanup_stale(&self, max_idle_millis: i64) -> io::Result<CleanupResult> {
        let cutoff = now_millis().saturating_sub(max_idle_millis);
        let mut deleted_bytes = 0;
        let mut deleted_uploads = 0;
        let mut reservations = Vec::new();
        let records = self.records()?;
        let known_ids = records
            .iter()
            .map(|record| record.id.clone())
            .collect::<std::collections::HashSet<_>>();
        for record in records {
            if record.complete || record.updated_at > cutoff {
                continue;
            }
            deleted_bytes += fs::metadata(self.data_path(&record.id))
                .map(|m| m.len())
                .unwrap_or(0);
            reservations.extend(record.public_reservation_id.clone());
            remove_if_exists(self.data_path(&record.id))?;
            remove_if_exists(self.record_path(&record.id))?;
            deleted_uploads += 1;
        }
        // A crash between creating the data file and its JSON record must not
        // leave an unaccounted orphan consuming the quota forever.
        if let Ok(entries) = fs::read_dir(self.root.join("files")) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(id) = path.file_stem().and_then(|value| value.to_str()) else {
                    continue;
                };
                if known_ids.contains(id)
                    || path.extension().and_then(|value| value.to_str()) != Some("data")
                {
                    continue;
                }
                let stale = fs::metadata(&path)
                    .and_then(|metadata| metadata.modified())
                    .ok()
                    .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                    .map(|elapsed| elapsed.as_millis() <= cutoff.max(0) as u128)
                    .unwrap_or(false);
                if stale {
                    deleted_bytes = deleted_bytes.saturating_add(
                        fs::metadata(&path)
                            .map(|metadata| metadata.len())
                            .unwrap_or(0),
                    );
                    remove_if_exists(path)?;
                }
            }
        }
        Ok(CleanupResult {
            deleted_bytes,
            deleted_uploads,
            public_reservation_ids: reservations,
        })
    }

    pub fn page_posts(
        &self,
        limit: usize,
        cursor: Option<usize>,
    ) -> io::Result<(Vec<Post>, Option<usize>)> {
        if !(1..=50).contains(&limit) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Page limit is invalid.",
            ));
        }
        let mut posts = self.posts()?;
        posts.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        let start = cursor.unwrap_or(0).min(posts.len());
        let end = (start + limit).min(posts.len());
        let next = (end < posts.len()).then_some(end);
        Ok((posts[start..end].to_vec(), next))
    }

    pub fn posts(&self) -> io::Result<Vec<Post>> {
        read_json_files(&self.root.join("fluo-posts"), ".post.json")
    }

    pub fn create_post(
        &self,
        post: &Post,
        owner: &str,
        reservation_bytes: Option<u64>,
    ) -> Result<(), StorageError> {
        if post.author != owner || post.id.is_empty() || !valid_id(&post.id) {
            return Err(StorageError::Invalid("Post payload is invalid."));
        }
        if post.body.len() > MAX_POST_BODY
            || (post.body.trim().is_empty() && post.attachments.is_empty())
            || post.attachments.len() > MAX_FLUO_ATTACHMENTS
        {
            return Err(StorageError::Invalid("Post payload is invalid."));
        }
        self.validate_post_attachments(
            &post.attachments,
            owner,
            post.public_reservation_id.as_deref(),
        )?;
        let payload_size = serde_json::to_vec(post)
            .map_err(|_| StorageError::Invalid("Post payload is invalid."))?
            .len() as u64;
        if let Some(limit) = reservation_bytes {
            if post.body.len() as u64 + post.attachments.iter().map(|item| item.size).sum::<u64>()
                > limit
            {
                return Err(StorageError::Quota);
            }
        }
        if self.reserved_bytes()?.saturating_add(payload_size) > self.quota_bytes {
            return Err(StorageError::Quota);
        }
        let path = self
            .root
            .join("fluo-posts")
            .join(format!("{}.post.json", post.id));
        atomic_write_json(&path, post).map_err(StorageError::Io)
    }

    pub fn delete_post(
        &self,
        id: &str,
        actor: &str,
        owner: bool,
    ) -> Result<Option<Post>, StorageError> {
        if !valid_id(id) {
            return Ok(None);
        }
        let path = self.root.join("fluo-posts").join(format!("{id}.post.json"));
        let Some(post): Option<Post> = read_json(&path).ok() else {
            return Ok(None);
        };
        if !owner && post.author != actor {
            return Err(StorageError::Forbidden);
        }
        remove_if_exists(path).map_err(StorageError::Io)?;
        for attachment in &post.attachments {
            let _ = self.delete_upload(&attachment.id, actor, true);
        }
        Ok(Some(post))
    }

    pub fn state(&self) -> io::Result<FeedState> {
        let mut posts = self.posts()?;
        posts.sort_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        let mut hasher = sha2::Sha256::new();
        for post in &posts {
            hasher.update(post.id.as_bytes());
            hasher.update(post.created_at.to_le_bytes());
        }
        Ok(FeedState {
            post_count: posts.len(),
            state_hash: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hasher.finalize()),
        })
    }

    pub fn create_envelope(
        &self,
        envelope: &Envelope,
        owner: &str,
        reservation_id: Option<&str>,
    ) -> Result<(), StorageError> {
        if envelope.sender != owner
            || !valid_id(&envelope.id)
            || envelope.sender == envelope.recipient
            || envelope.attachments.len() > MAX_LIGO_ATTACHMENTS
            || envelope.body.len() > MAX_LIGO_BODY
        {
            return Err(StorageError::Invalid("Message envelope is invalid."));
        }
        if envelope.body.trim().is_empty() && envelope.attachments.is_empty() {
            return Err(StorageError::Invalid("Message envelope is invalid."));
        }
        for attachment in &envelope.attachments {
            let Some((record, path)) = self
                .completed_file(&attachment.id)
                .map_err(StorageError::Io)?
            else {
                return Err(StorageError::Missing);
            };
            if record.created_by.as_deref() != Some(owner)
                || path.metadata().map(|m| m.len()).unwrap_or(0) != attachment.size
                || record.public_reservation_id.as_deref() != reservation_id
            {
                return Err(StorageError::Missing);
            }
        }
        let path = self
            .root
            .join("ligo-envelopes")
            .join(format!("{}.envelope.json", envelope.id));
        if path.exists() {
            return Err(StorageError::Conflict);
        }
        let bytes = serde_json::to_vec(envelope)
            .map_err(|_| StorageError::Invalid("Message envelope is invalid."))?;
        if bytes.len() > 64 * 1024
            || self.reserved_bytes()?.saturating_add(bytes.len() as u64) > self.quota_bytes
        {
            return Err(StorageError::Quota);
        }
        atomic_write_bytes(&path, &bytes).map_err(StorageError::Io)
    }

    pub fn read_envelope(&self, id: &str, actor: &str) -> io::Result<Option<Envelope>> {
        if !valid_id(id) {
            return Ok(None);
        }
        let envelope: Envelope = match read_json(
            &self
                .root
                .join("ligo-envelopes")
                .join(format!("{id}.envelope.json")),
        ) {
            Ok(value) => value,
            Err(_) => return Ok(None),
        };
        Ok((envelope.sender == actor || envelope.recipient == actor).then_some(envelope))
    }

    pub fn list_envelopes(&self, actor: &str) -> io::Result<Vec<Envelope>> {
        let mut values = read_json_files(&self.root.join("ligo-envelopes"), ".envelope.json")?;
        values.retain(|value: &Envelope| value.sender == actor || value.recipient == actor);
        values.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        Ok(values)
    }

    pub fn delete_envelope(&self, id: &str, actor: &str) -> Result<bool, StorageError> {
        let Some(envelope) = self.read_envelope(id, actor).map_err(StorageError::Io)? else {
            return Ok(false);
        };
        for attachment in &envelope.attachments {
            let _ = self.delete_upload(&attachment.id, actor, true);
        }
        Ok(remove_if_exists(
            self.root
                .join("ligo-envelopes")
                .join(format!("{id}.envelope.json")),
        )
        .map_err(StorageError::Io)?)
    }

    pub fn delete_envelope_for_cleanup(&self, id: &str) -> Result<bool, StorageError> {
        if !valid_id(id) {
            return Ok(false);
        }
        let path = self
            .root
            .join("ligo-envelopes")
            .join(format!("{id}.envelope.json"));
        let Some(envelope): Option<Envelope> = read_json(&path).ok() else {
            return Ok(!path.exists());
        };
        for attachment in &envelope.attachments {
            let _ = self.delete_upload(&attachment.id, "", true);
        }
        Ok(remove_if_exists(path).map_err(StorageError::Io)?)
    }

    pub fn page_rondo(
        &self,
        space_id: &str,
        room_id: &str,
        limit: usize,
        cursor: Option<usize>,
    ) -> io::Result<(Vec<RondoMessage>, Option<usize>)> {
        if !valid_id(space_id) || !valid_id(room_id) || !(1..=50).contains(&limit) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Message page is invalid.",
            ));
        }
        let mut values: Vec<RondoMessage> =
            read_json_files(&self.rondo_dir(space_id, room_id), ".message.json")?;
        values.sort_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        let start = cursor.unwrap_or(values.len()).min(values.len());
        let end = start.saturating_sub(limit);
        let page = values[end..start].iter().rev().cloned().collect::<Vec<_>>();
        Ok((page, (end > 0).then_some(end)))
    }

    pub fn create_rondo(
        &self,
        space_id: &str,
        room_id: &str,
        message: &RondoMessage,
        space_limit: u64,
    ) -> Result<(), StorageError> {
        if !valid_id(space_id)
            || !valid_id(room_id)
            || !valid_id(&message.id)
            || message.body.trim().is_empty()
            || message.body.len() > MAX_RONDO_BODY
        {
            return Err(StorageError::Invalid("Message payload is invalid."));
        }
        let bytes = serde_json::to_vec(message)
            .map_err(|_| StorageError::Invalid("Message payload is invalid."))?;
        let directory = self.rondo_dir(space_id, room_id);
        if tree_bytes(&self.root.join("rondo-spaces").join(space_id))
            .unwrap_or(0)
            .saturating_add(bytes.len() as u64)
            > space_limit
        {
            return Err(StorageError::Quota);
        }
        if self.reserved_bytes()?.saturating_add(bytes.len() as u64) > self.quota_bytes {
            return Err(StorageError::Quota);
        }
        fs::create_dir_all(&directory).map_err(StorageError::Io)?;
        atomic_write_bytes(
            &directory.join(format!("{}.message.json", message.id)),
            &bytes,
        )
        .map_err(StorageError::Io)
    }

    pub fn delete_rondo(
        &self,
        space_id: &str,
        room_id: &str,
        id: &str,
        actor: &str,
        moderate: bool,
    ) -> Result<bool, StorageError> {
        if !valid_id(space_id) || !valid_id(room_id) || !valid_id(id) {
            return Ok(false);
        }
        let path = self
            .rondo_dir(space_id, room_id)
            .join(format!("{id}.message.json"));
        let Some(message) = read_json::<RondoMessage>(&path).ok() else {
            return Ok(false);
        };
        if !moderate && message.author != actor {
            return Err(StorageError::Forbidden);
        }
        Ok(remove_if_exists(path).map_err(StorageError::Io)?)
    }

    pub fn rondo_messages(&self) -> io::Result<Vec<StoredRondoMessage>> {
        let root = self.root.join("rondo-spaces");
        let mut result = Vec::new();
        for space in fs::read_dir(root)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_dir())
        {
            let Some(space_id) = space
                .file_name()
                .to_str()
                .map(str::to_owned)
                .filter(|value| valid_id(value))
            else {
                continue;
            };
            for room in fs::read_dir(space.path())
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_dir())
            {
                let Some(room_id) = room
                    .file_name()
                    .to_str()
                    .map(str::to_owned)
                    .filter(|value| valid_id(value))
                else {
                    continue;
                };
                for message in read_json_files::<RondoMessage>(&room.path(), ".message.json")? {
                    result.push(StoredRondoMessage {
                        space_id: space_id.clone(),
                        room_id: room_id.clone(),
                        message,
                    });
                }
            }
        }
        result.sort_by(|a, b| {
            b.message
                .created_at
                .cmp(&a.message.created_at)
                .then_with(|| b.message.id.cmp(&a.message.id))
        });
        Ok(result)
    }

    fn validate_post_attachments(
        &self,
        attachments: &[Attachment],
        owner: &str,
        reservation_id: Option<&str>,
    ) -> Result<(), StorageError> {
        let mut seen = std::collections::HashSet::new();
        for attachment in attachments {
            if !seen.insert(&attachment.id)
                || !valid_id(&attachment.id)
                || !matches!(attachment.kind.as_str(), "gif" | "image" | "video")
                || attachment.name.len() > 180
                || attachment.mime_type.len() > 120
            {
                return Err(StorageError::Invalid("Post payload is invalid."));
            }
            let Some((record, path)) = self
                .completed_file(&attachment.id)
                .map_err(StorageError::Io)?
            else {
                return Err(StorageError::Missing);
            };
            if record.created_by.as_deref() != Some(owner)
                || path.metadata().map(|m| m.len()).unwrap_or(0) != attachment.size
                || record.public_reservation_id.as_deref() != reservation_id
            {
                return Err(StorageError::Missing);
            }
        }
        Ok(())
    }

    fn records_path(&self) -> PathBuf {
        self.root.join("records")
    }
    fn data_path(&self, id: &str) -> PathBuf {
        self.root.join("files").join(format!("{id}.data"))
    }
    fn record_path(&self, id: &str) -> PathBuf {
        self.records_path().join(format!("{id}.json"))
    }
    fn rondo_dir(&self, space_id: &str, room_id: &str) -> PathBuf {
        self.root.join("rondo-spaces").join(space_id).join(room_id)
    }

    fn write_record(&self, record: &UploadRecord) -> io::Result<()> {
        atomic_write_json(&self.record_path(&record.id), record)
    }

    fn reserved_bytes(&self) -> io::Result<u64> {
        let records = self.records()?;
        let known = records
            .iter()
            .map(|record| record.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        let orphan = fs::read_dir(self.root.join("files"))?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("data"))
            .filter_map(|path| {
                let id = path.file_stem()?.to_str()?.to_owned();
                if known.contains(id.as_str()) {
                    return None;
                }
                fs::metadata(path).ok().map(|metadata| metadata.len())
            })
            .sum::<u64>();
        Ok(records
            .into_iter()
            .map(|record| record.length)
            .sum::<u64>()
            .saturating_add(orphan)
            .saturating_add(tree_bytes(&self.root.join("fluo-posts"))?)
            .saturating_add(tree_bytes(&self.root.join("ligo-envelopes"))?)
            .saturating_add(tree_bytes(&self.root.join("rondo-spaces"))?))
    }

    fn posts_as_items(
        &self,
        actor: &str,
        owner: bool,
        items: &mut Vec<StorageItem>,
    ) -> io::Result<()> {
        for post in self.posts()? {
            let size =
                post.body.len() as u64 + post.attachments.iter().map(|a| a.size).sum::<u64>();
            items.push(StorageItem {
                completed: true,
                created_at: post.created_at,
                deletable: owner || post.author == actor,
                id: post.id.clone(),
                kind: "fluo-post".to_owned(),
                name: "Fluo post".to_owned(),
                owner: post.author,
                size_bytes: size,
                storage_key: post.id,
                mime_type: None,
                preview: Some(post.body.chars().take(180).collect()),
            });
        }
        Ok(())
    }

    fn storage_items(&self, actor: &str, owner: bool) -> io::Result<Vec<StorageItem>> {
        let mut items = Vec::new();
        for record in self.records()? {
            let filename =
                metadata_filename(&record.metadata).unwrap_or_else(|| format!("{}.bin", record.id));
            let size = fs::metadata(self.data_path(&record.id))
                .map(|metadata| metadata.len())
                .unwrap_or(record.offset);
            items.push(StorageItem {
                completed: record.complete,
                created_at: record.created_at,
                deletable: owner || record.created_by.as_deref() == Some(actor),
                id: record.id.clone(),
                kind: "file".to_owned(),
                name: filename,
                owner: record.created_by.unwrap_or_default(),
                size_bytes: size,
                storage_key: record.id,
                mime_type: metadata_media_type(&record.metadata),
                preview: None,
            });
        }
        self.posts_as_items(actor, owner, &mut items)?;
        for envelope in self.list_envelopes(actor)? {
            let size = envelope.body.len() as u64
                + envelope.attachments.iter().map(|a| a.size).sum::<u64>();
            items.push(StorageItem {
                completed: true,
                created_at: envelope.created_at,
                deletable: true,
                id: envelope.id.clone(),
                kind: "ligo-envelope".to_owned(),
                name: "Ligo message".to_owned(),
                owner: envelope.sender,
                size_bytes: size,
                storage_key: envelope.id,
                mime_type: None,
                preview: Some(envelope.body.chars().take(180).collect()),
            });
        }
        for stored in self.rondo_messages()? {
            let message = stored.message;
            items.push(StorageItem {
                completed: true,
                created_at: message.created_at,
                deletable: owner || message.author == actor,
                id: message.id.clone(),
                kind: "rondo-message".to_owned(),
                name: "Rondo message".to_owned(),
                owner: message.author,
                size_bytes: message.body.len() as u64,
                storage_key: format!("{}.{}.{}", stored.space_id, stored.room_id, message.id),
                mime_type: None,
                preview: Some(message.body.chars().take(180).collect()),
            });
        }
        items.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        Ok(items)
    }

    pub fn clear(&self) -> io::Result<SpaceClearResult> {
        let files = all_files(&self.root)?;
        let deleted_posts = fs::read_dir(self.root.join("fluo-posts"))?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("json")
            })
            .count();
        let deleted_uploads = self.records()?.len();
        let deleted_bytes = files
            .iter()
            .filter_map(|path| fs::metadata(path).ok())
            .map(|metadata| metadata.len())
            .sum();
        for directory in [
            "files",
            "records",
            "fluo-posts",
            "rondo-spaces",
            "ligo-envelopes",
        ] {
            let path = self.root.join(directory);
            if path.exists() {
                fs::remove_dir_all(&path)?;
            }
            fs::create_dir_all(path)?;
        }
        Ok(SpaceClearResult {
            deleted_bytes,
            deleted_uploads,
            deleted_posts,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedState {
    pub post_count: usize,
    pub state_hash: String,
}

#[derive(Debug, Clone)]
pub struct CleanupResult {
    pub deleted_bytes: u64,
    pub deleted_uploads: usize,
    pub public_reservation_ids: Vec<String>,
}

#[derive(Debug)]
pub enum StorageError {
    Io(io::Error),
    Invalid(&'static str),
    Missing,
    Forbidden,
    Quota,
    Conflict,
    Offset(u64),
}

impl From<io::Error> for StorageError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Invalid(message) => formatter.write_str(message),
            Self::Missing => formatter.write_str("Upload or attachment was not found."),
            Self::Forbidden => formatter.write_str("This item belongs to another account."),
            Self::Quota => formatter.write_str("Allocated storage is full."),
            Self::Conflict => formatter.write_str("Message already exists."),
            Self::Offset(offset) => write!(formatter, "Upload offset does not match ({offset})."),
        }
    }
}

impl std::error::Error for StorageError {}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> io::Result<T> {
    let bytes = fs::read(path)?;
    serde_json::from_slice(&bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn read_json_files<T: for<'de> Deserialize<'de>>(
    directory: &Path,
    suffix: &str,
) -> io::Result<Vec<T>> {
    let mut values = Vec::new();
    if !directory.is_dir() {
        return Ok(values);
    }
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_file()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(suffix))
        {
            if let Ok(value) = read_json(&path) {
                values.push(value);
            }
        }
    }
    Ok(values)
}

fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    atomic_write_bytes(path, &bytes)
}

fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("data")
    ));
    let mut file = File::create(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary, path)
}

fn remove_if_exists(path: PathBuf) -> io::Result<bool> {
    if !path.exists() {
        return Ok(true);
    }
    fs::remove_file(path).map(|_| true)
}

fn all_files(root: &Path) -> io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    if !root.is_dir() {
        return Ok(files);
    }
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            files.extend(all_files(&path)?);
        } else if path.is_file() {
            files.push(path);
        }
    }
    Ok(files)
}

fn tree_bytes(path: &Path) -> io::Result<u64> {
    if path.is_file() {
        return Ok(fs::metadata(path)?.len());
    }
    if !path.is_dir() {
        return Ok(0);
    }
    fs::read_dir(path)?.try_fold(0_u64, |total, entry| {
        Ok(total.saturating_add(tree_bytes(&entry?.path())?))
    })
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn valid_id(value: &str) -> bool {
    Uuid::parse_str(value).is_ok() && value.len() == 36
}

pub fn metadata_filename(metadata: &str) -> Option<String> {
    metadata
        .split(',')
        .map(str::trim)
        .find_map(|item| item.strip_prefix("filename "))
        .and_then(|value| base64::engine::general_purpose::STANDARD.decode(value).ok())
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .map(|value| {
            value
                .chars()
                .filter(|character| {
                    character.is_ascii_graphic() && !matches!(character, '"' | '\\' | '/')
                })
                .take(180)
                .collect()
        })
        .filter(|value: &String| !value.is_empty())
}

pub fn metadata_media_type(metadata: &str) -> Option<String> {
    metadata
        .split(',')
        .map(str::trim)
        .find_map(|item| item.strip_prefix("filetype "))
        .and_then(|value| base64::engine::general_purpose::STANDARD.decode(value).ok())
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| value.starts_with("image/") || value.starts_with("video/"))
}

pub fn media_type(filename: &str) -> &'static str {
    match filename
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "gif" => "image/gif",
        "jpeg" | "jpg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::{NodeStorage, Space};
    use std::fs;
    use std::io::Cursor;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "kaordo-nodo-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn tus_upload_survives_a_new_store_instance() {
        let root = temporary_root();
        let storage = NodeStorage::open(&root, 0, 1024 * 1024).unwrap();
        let record = storage
            .space(Space::Private)
            .create_upload(
                11,
                "filename dGVzdC50eHQ=,filetype dGV4dC9wbGFpbg==".to_owned(),
                "alice",
                None,
                None,
            )
            .unwrap();
        let mut bytes = Cursor::new(b"hello world".to_vec());
        let next = storage
            .space(Space::Private)
            .append_upload(&record.id, 0, 11, &mut bytes, "alice", false)
            .unwrap();
        assert!(next.complete);
        let reopened = NodeStorage::open(&root, 0, 1024 * 1024).unwrap();
        let (_, path) = reopened
            .space(Space::Private)
            .completed_file(&record.id)
            .unwrap()
            .unwrap();
        assert_eq!(fs::read(path).unwrap(), b"hello world");
        fs::remove_dir_all(root).unwrap();
    }
}
