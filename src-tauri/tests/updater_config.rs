#![cfg(target_os = "windows")]

use tauri_plugin_updater::Config;

#[test]
fn production_config_enforces_the_native_updater_trust_contract() {
    let app_config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let config: Config = serde_json::from_value(app_config["plugins"]["updater"].clone()).unwrap();

    assert_eq!(config.endpoints.len(), 1);
    assert_eq!(
        config.endpoints[0].as_str(),
        "https://github.com/TommyMoonn/archeion/releases/latest/download/latest.json"
    );
    assert!(!config.pubkey.trim().is_empty());
    assert!(config.require_signed_version);
    assert!(!config.allow_downgrades);
    assert!(!config.dangerous_insecure_transport_protocol);
    assert!(!config.dangerous_accept_invalid_certs);
    assert!(!config.dangerous_accept_invalid_hostnames);

    let windows = config.windows.unwrap();
    assert_eq!(windows.install_mode.to_string(), "passive");
    assert!(windows.installer_args.is_empty());
    assert_eq!(windows.install_mode.nsis_args(), &["/P"]);
    assert_eq!(windows.install_mode.msiexec_args(), &["/passive"]);
}
