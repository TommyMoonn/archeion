use std::{fs, path::Path, time::UNIX_EPOCH};

#[derive(Clone, Debug)]
pub(super) struct FileFingerprint {
    pub(super) size: u64,
    pub(super) modified_at: u64,
}

fn modified_at_millis(path: &Path) -> Result<u64, String> {
    let modified = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .modified()
        .map_err(|error| error.to_string())?;
    modified
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .map_err(|error| error.to_string())
}

pub(super) fn file_fingerprint(
    path: &Path,
    unavailable_message: &str,
) -> Result<FileFingerprint, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err(unavailable_message.to_string());
    }
    Ok(FileFingerprint {
        size: metadata.len(),
        modified_at: modified_at_millis(path)?,
    })
}

pub(super) fn assert_fingerprint(
    label: &str,
    actual: &FileFingerprint,
    expected_size: u64,
    expected_modified_at: u64,
) -> Result<(), String> {
    if actual.size != expected_size || actual.modified_at != expected_modified_at {
        return Err(format!(
            "The {label} changed after the preview was created. Review it again before writing."
        ));
    }
    Ok(())
}
