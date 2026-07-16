use std::process::Command;

const SUPPORTED_SCHEMES: [&str; 2] = ["http", "https"];

fn has_explicit_network_authority(raw_url: &str) -> bool {
    let Some((_, remainder)) = raw_url.split_once(':') else {
        return false;
    };
    let Some(authority_and_path) = remainder.strip_prefix("//") else {
        return false;
    };
    let authority_end = authority_and_path
        .find(['/', '?', '#'])
        .unwrap_or(authority_and_path.len());
    let authority = &authority_and_path[..authority_end];

    !authority.is_empty() && !authority.contains('\\')
}

fn validate_external_url(raw_url: &str) -> Result<tauri::Url, String> {
    if raw_url.bytes().any(|byte| byte.is_ascii_control()) {
        return Err("The external URL is malformed.".to_string());
    }
    let trimmed = raw_url.trim();
    if !has_explicit_network_authority(trimmed) {
        return Err("The external URL is malformed.".to_string());
    }
    let url =
        tauri::Url::parse(trimmed).map_err(|_| "The external URL is malformed.".to_string())?;

    if !SUPPORTED_SCHEMES.contains(&url.scheme()) {
        return Err("Only HTTP and HTTPS links can be opened.".to_string());
    }
    if url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err("The external URL is not supported.".to_string());
    }

    Ok(url)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let validated = validate_external_url(&url)?;
    open_url_in_browser(validated.as_str())
}

fn open_url_in_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(url);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open the external link: {error}"))
}

#[cfg(test)]
mod tests {
    use super::validate_external_url;

    #[test]
    fn accepts_http_and_https_urls_with_hosts() {
        assert_eq!(
            validate_external_url("https://example.com/notes?id=2#source")
                .expect("HTTPS URL should be valid")
                .as_str(),
            "https://example.com/notes?id=2#source"
        );
        for url in [
            "http://example.com",
            "http://example.com:8080/source",
            "https://192.0.2.1/resource",
            "https://[2001:db8::1]:8443/resource",
            "https://例え.テスト/資料?q=読書#注",
        ] {
            assert!(
                validate_external_url(url).is_ok(),
                "{url} should be accepted"
            );
        }
    }

    #[test]
    fn rejects_unsafe_or_unsupported_urls() {
        for url in [
            "javascript:alert(1)",
            "data:text/html,unsafe",
            "file:///tmp/book.xhtml",
            "mailto:reader@example.com",
            "https://user:secret@example.com",
            "https:example.com",
            "http:foo.com",
            r"https:\example.com",
            r"https:\\example.com",
            "https:///missing-host",
            "https://",
            "https://exa\tmple.com",
            "https://exa\nmple.com",
            "https://exa\rmple.com",
            "https://example.com/\nsource",
            "https://example.com/\u{7f}source",
            "not a url",
        ] {
            assert!(
                validate_external_url(url).is_err(),
                "{url} should be rejected"
            );
        }
    }
}
