use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Copy)]
pub(crate) enum ExportFileKind {
    Annotation,
    Illustration,
}

impl ExportFileKind {
    fn label(self) -> &'static str {
        match self {
            Self::Annotation => "annotation export",
            Self::Illustration => "illustration image",
        }
    }
}

pub(crate) fn write_atomic_export_file<R>(
    destination: &Path,
    contents: &[u8],
    kind: ExportFileKind,
    mut rename: R,
) -> Result<(), String>
where
    R: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    let parent = destination
        .parent()
        .filter(|value| value.is_dir())
        .ok_or_else(|| format!("The {} folder is unavailable.", kind.label()))?;
    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("The {} file name is unavailable.", kind.label()))?;
    let replacing = destination_is_regular_file(destination, kind)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let temporary = parent.join(format!(".{file_name}.{nonce}.tmp"));
    let backup = parent.join(format!(".{file_name}.{nonce}.bak"));

    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(contents)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);

        if destination_is_regular_file(destination, kind)? != replacing {
            return Err(format!(
                "The {} destination changed before it was written.",
                kind.label()
            ));
        }
        if replacing {
            rename(destination, &backup).map_err(|error| error.to_string())?;
        }
        if let Err(error) = rename(&temporary, destination) {
            if replacing {
                let _ = rename(&backup, destination);
            }
            return Err(error.to_string());
        }
        if replacing {
            let _ = fs::remove_file(&backup);
        }
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
        if backup.exists() && destination.exists() {
            let _ = fs::remove_file(backup);
        }
    }
    write_result
}

fn destination_is_regular_file(destination: &Path, kind: ExportFileKind) -> Result<bool, String> {
    match fs::symlink_metadata(destination) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(true),
        Ok(_) => Err(format!(
            "The {} destination must be a regular file.",
            kind.label()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}
