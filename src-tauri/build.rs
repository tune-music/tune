fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            // вызываются со страницы Яндекс Музыки
            "page_ready",
            "page_track",
            "page_scripts",
            "open_manager",
            "page_window",
            "page_cookie",
            "page_download",
            "page_reveal_download",
            "page_lyrics",
            "install_update",
            "skip_update",
            // страница первой загрузки интерфейса
            "client_status",
            "client_retry",
            // вызываются из окна Tune
            "list_addons",
            "set_addon_enabled",
            "delete_addon",
            "addon_settings",
            "set_addon_setting",
            "reset_addon_settings",
            "catalog",
            "install_from_catalog",
            "install_from_url",
            "install_upload",
            "create_addon",
            "read_addon_file",
            "write_addon_file",
            "open_folder",
            "open_link",
            "reload_status",
            "reload_client",
            "show_client",
            "get_settings",
            "app_info",
            "set_settings",
            "check_update",
        ]),
    ))
    .expect("failed to run tauri-build");
}
