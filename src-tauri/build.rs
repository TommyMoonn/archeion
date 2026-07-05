fn main() {
    #[cfg(target_os = "windows")]
    {
        use std::{env, fs, path::PathBuf, process};

        let manifest_dir =
            PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("missing manifest directory"));
        let source_icon = manifest_dir.join("icons").join("icon.ico");
        let public_dir = env::var_os("PUBLIC")
            .map(PathBuf::from)
            .filter(|path| !path.to_string_lossy().contains('\''))
            .expect("Windows PUBLIC directory must not contain an apostrophe");
        let temporary_dir = public_dir.join(format!(".novel-archive-build-{}", process::id()));
        let temporary_icon = temporary_dir.join("icon.ico");

        fs::create_dir_all(&temporary_dir).expect("failed to create temporary icon directory");
        fs::copy(&source_icon, &temporary_icon).expect("failed to copy the Windows icon");

        let windows = tauri_build::WindowsAttributes::new().window_icon_path(&temporary_icon);
        let attributes = tauri_build::Attributes::new().windows_attributes(windows);
        let result = tauri_build::try_build(attributes);

        let _ = fs::remove_file(&temporary_icon);
        let _ = fs::remove_dir(&temporary_dir);

        result.expect("failed to run Tauri build script");
    }

    #[cfg(not(target_os = "windows"))]
    tauri_build::build();
}
