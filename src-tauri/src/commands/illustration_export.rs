use std::{collections::HashMap, fs, path::Path, sync::OnceLock};

use percent_encoding::percent_decode_str;
use serde::Deserialize;

use super::export_file::{write_atomic_export_file, ExportFileKind};

const ILLUSTRATION_IMAGE_CONTRACT_JSON: &str =
    include_str!("../../../shared/illustration-image-contract.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IllustrationImageContract {
    maximum_bytes: usize,
    types: Vec<IllustrationImageType>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IllustrationImageType {
    media_type: String,
    extensions: Vec<String>,
    preferred_extension: String,
    label: String,
}

struct IllustrationImageWriteRequest {
    contents: Vec<u8>,
    media_type: String,
    path: String,
}

#[tauri::command]
pub async fn write_illustration_image_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let request = parse_illustration_image_write_request(request)?;
    tauri::async_runtime::spawn_blocking(move || {
        write_illustration_image_bytes(request.path, &request.contents, &request.media_type)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn parse_illustration_image_write_request(
    request: tauri::ipc::Request<'_>,
) -> Result<IllustrationImageWriteRequest, String> {
    const MEDIA_TYPE_HEADER: &str = "x-archeion-illustration-media-type";
    const PATH_HEADER: &str = "x-archeion-illustration-path";

    let media_type = request
        .headers()
        .get(MEDIA_TYPE_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "The illustration image media type is unsupported.".to_string())?;
    if illustration_image_type(media_type).is_none() {
        return Err("The illustration image media type is unsupported.".to_string());
    }
    let encoded_path = request
        .headers()
        .get(PATH_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "The illustration image destination is unavailable.".to_string())?;
    let path = percent_decode_str(encoded_path)
        .decode_utf8()
        .map_err(|_| "The illustration image destination is invalid.".to_string())?;
    let tauri::ipc::InvokeBody::Raw(contents) = request.body() else {
        return Err("The illustration image bytes are unavailable.".to_string());
    };
    validate_content_bounds(contents)?;

    Ok(IllustrationImageWriteRequest {
        contents: contents.clone(),
        media_type: media_type.to_string(),
        path: path.into_owned(),
    })
}

fn write_illustration_image_bytes(
    path: String,
    contents: &[u8],
    media_type: &str,
) -> Result<(), String> {
    validate_content_bounds(contents)?;
    let image_type = illustration_image_type(media_type)
        .ok_or_else(|| "The illustration image media type is unsupported.".to_string())?;

    let destination = std::path::PathBuf::from(path);
    if !destination.is_absolute() {
        return Err("The illustration image destination must be an absolute path.".to_string());
    }
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !image_type
        .extensions
        .iter()
        .any(|accepted| extension.eq_ignore_ascii_case(accepted))
    {
        return Err(format!(
            "{} exports require a {} file name.",
            image_type.label,
            extension_list(&image_type.extensions)
        ));
    }

    write_illustration_image_to_destination(&destination, contents, |from, to| fs::rename(from, to))
}

fn validate_content_bounds(contents: &[u8]) -> Result<(), String> {
    if contents.is_empty() {
        return Err("The illustration image is empty.".to_string());
    }
    if contents.len() > illustration_image_contract()?.maximum_bytes {
        return Err("The illustration image is too large to write safely.".to_string());
    }
    Ok(())
}

fn illustration_image_type(media_type: &str) -> Option<&'static IllustrationImageType> {
    illustration_image_contract()
        .ok()?
        .types
        .iter()
        .find(|image_type| image_type.media_type == media_type)
}

fn illustration_image_contract() -> Result<&'static IllustrationImageContract, String> {
    static CONTRACT: OnceLock<Result<IllustrationImageContract, String>> = OnceLock::new();
    CONTRACT
        .get_or_init(|| parse_illustration_image_contract(ILLUSTRATION_IMAGE_CONTRACT_JSON))
        .as_ref()
        .map_err(Clone::clone)
}

fn parse_illustration_image_contract(value: &str) -> Result<IllustrationImageContract, String> {
    let contract: IllustrationImageContract = serde_json::from_str(value)
        .map_err(|error| format!("The illustration image contract is invalid: {error}"))?;
    if contract.maximum_bytes == 0 || contract.types.len() != 5 {
        return Err(
            "The illustration image contract has invalid bounds or type count.".to_string(),
        );
    }

    let mut media_types = std::collections::HashSet::new();
    let mut extension_owners = HashMap::new();
    for image_type in &contract.types {
        if image_type.media_type.is_empty()
            || image_type.label.is_empty()
            || image_type.extensions.is_empty()
            || !media_types.insert(image_type.media_type.as_str())
        {
            return Err(
                "The illustration image contract contains an invalid image type.".to_string(),
            );
        }
        let mut type_extensions = std::collections::HashSet::new();
        for extension in &image_type.extensions {
            if extension.is_empty()
                || !extension
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                || !type_extensions.insert(extension.as_str())
            {
                return Err(format!(
                    "The illustration image contract contains an invalid extension for {}.",
                    image_type.media_type
                ));
            }
            if extension_owners
                .insert(extension.as_str(), image_type.media_type.as_str())
                .is_some()
            {
                return Err(format!(
                    "The illustration image contract assigns .{extension} more than once."
                ));
            }
        }
        if !image_type
            .extensions
            .contains(&image_type.preferred_extension)
        {
            return Err(format!(
                "The illustration image contract has an invalid preferred extension for {}.",
                image_type.media_type
            ));
        }
    }
    Ok(contract)
}

fn extension_list(extensions: &[String]) -> String {
    extensions
        .iter()
        .map(|extension| format!(".{extension}"))
        .collect::<Vec<_>>()
        .join(" or ")
}

fn write_illustration_image_to_destination<R>(
    destination: &Path,
    contents: &[u8],
    rename: R,
) -> Result<(), String>
where
    R: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    write_atomic_export_file(destination, contents, ExportFileKind::Illustration, rename)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        illustration_image_contract, write_illustration_image_bytes,
        write_illustration_image_to_destination,
    };

    fn test_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-illustration-export-{nonce}"))
    }

    #[test]
    fn shared_contract_is_complete_and_non_conflicting() {
        let contract = illustration_image_contract().expect("shared contract should be valid");
        assert!(contract.maximum_bytes > 0);
        assert_eq!(contract.types.len(), 5);
        assert!(contract
            .types
            .iter()
            .any(|image_type| image_type.media_type == "image/avif"));
        assert!(contract
            .types
            .iter()
            .any(|image_type| image_type.media_type == "image/gif"));
        let jpeg = contract
            .types
            .iter()
            .find(|image_type| image_type.media_type == "image/jpeg")
            .expect("JPEG should be supported");
        assert_eq!(jpeg.extensions, ["jpg", "jpeg"]);
        assert!(contract
            .types
            .iter()
            .any(|image_type| image_type.media_type == "image/png"));
        assert!(contract
            .types
            .iter()
            .any(|image_type| image_type.media_type == "image/webp"));
        assert!(!contract
            .types
            .iter()
            .any(|image_type| image_type.media_type == "image/svg+xml"));
    }

    #[test]
    fn writes_each_supported_image_type() {
        let root = test_root();
        fs::create_dir_all(&root).expect("export folder should be created");
        let contract = illustration_image_contract().expect("shared contract should be valid");
        for image_type in &contract.types {
            for extension in &image_type.extensions {
                let destination = root.join(format!("illustration.{extension}"));
                write_illustration_image_bytes(
                    destination.to_string_lossy().to_string(),
                    &[1, 2, 3, 4],
                    &image_type.media_type,
                )
                .expect("supported illustration should be written");
                assert_eq!(
                    fs::read(&destination).expect("illustration should be readable"),
                    [1, 2, 3, 4]
                );
            }
        }
        fs::remove_dir_all(root).expect("test export folder should be removed");
    }

    #[test]
    fn rejects_invalid_destinations_and_content_bounds() {
        let root = test_root();
        fs::create_dir_all(&root).expect("export folder should be created");
        let missing_parent = root.join("missing").join("illustration.jpg");
        let mismatch = root.join("illustration.png");
        let contract = illustration_image_contract().expect("shared contract should be valid");
        let oversized_contents = vec![0; contract.maximum_bytes + 1];

        assert!(
            write_illustration_image_bytes("illustration.jpg".to_string(), &[1], "image/jpeg")
                .is_err()
        );
        assert!(write_illustration_image_bytes(
            missing_parent.to_string_lossy().to_string(),
            &[1],
            "image/jpeg"
        )
        .is_err());
        assert!(write_illustration_image_bytes(
            mismatch.to_string_lossy().to_string(),
            &[1],
            "image/jpeg"
        )
        .is_err());
        assert!(write_illustration_image_bytes(
            root.join("empty.jpg").to_string_lossy().to_string(),
            &[],
            "image/jpeg"
        )
        .is_err());
        assert!(write_illustration_image_bytes(
            root.join("oversized.jpg").to_string_lossy().to_string(),
            &oversized_contents,
            "image/jpeg"
        )
        .is_err());
        assert!(fs::read_dir(&root)
            .expect("export folder should be readable")
            .next()
            .is_none());
        fs::remove_dir_all(root).expect("test export folder should be removed");
    }

    #[test]
    fn rejects_non_file_and_symlink_destinations() {
        let root = test_root();
        let directory_destination = root.join("illustration.png");
        fs::create_dir_all(&directory_destination).expect("directory destination should exist");
        assert!(write_illustration_image_bytes(
            directory_destination.to_string_lossy().to_string(),
            &[1],
            "image/png"
        )
        .is_err());

        let target = root.join("target");
        let symlink = root.join("illustration.jpg");
        fs::create_dir(&target).expect("symlink target should be created");
        create_directory_symlink(&target, &symlink).expect("directory symlink should be created");
        assert!(write_illustration_image_bytes(
            symlink.to_string_lossy().to_string(),
            &[1],
            "image/jpeg"
        )
        .is_err());
        assert!(target.is_dir());
        fs::remove_dir_all(root).expect("test export folder should be removed");
    }

    #[cfg(unix)]
    fn create_directory_symlink(
        target: &std::path::Path,
        link: &std::path::Path,
    ) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(windows)]
    fn create_directory_symlink(
        target: &std::path::Path,
        link: &std::path::Path,
    ) -> std::io::Result<()> {
        match std::os::windows::fs::symlink_dir(target, link) {
            Ok(()) => Ok(()),
            Err(error) if error.raw_os_error() == Some(1314) => {
                let output = std::process::Command::new("cmd")
                    .args(["/c", "mklink", "/J"])
                    .arg(link)
                    .arg(target)
                    .output()?;
                if output.status.success() {
                    Ok(())
                } else {
                    Err(std::io::Error::other("junction creation failed"))
                }
            }
            Err(error) => Err(error),
        }
    }

    #[test]
    fn replaces_atomically_and_cleans_failed_temporary_files() {
        let root = test_root();
        fs::create_dir_all(&root).expect("export folder should be created");
        let destination = root.join("illustration.webp");
        fs::write(&destination, [1, 2]).expect("original illustration should be written");

        write_illustration_image_bytes(
            destination.to_string_lossy().to_string(),
            &[3, 4, 5],
            "image/webp",
        )
        .expect("replacement illustration should be written");
        assert_eq!(
            fs::read(&destination).expect("replacement should be readable"),
            [3, 4, 5]
        );
        assert_eq!(
            fs::read_dir(&root)
                .expect("folder should be readable")
                .count(),
            1
        );

        let mut rename_count = 0;
        let result =
            write_illustration_image_to_destination(&destination, &[6, 7, 8], |from, to| {
                rename_count += 1;
                if rename_count == 2 {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "replacement blocked",
                    ));
                }
                fs::rename(from, to)
            });
        assert!(result.is_err());
        assert_eq!(
            fs::read(&destination).expect("original replacement should be restored"),
            [3, 4, 5]
        );
        assert_eq!(
            fs::read_dir(&root)
                .expect("folder should be readable")
                .count(),
            1
        );
        fs::remove_dir_all(root).expect("test export folder should be removed");
    }
}
