fn main() {
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to prepare Tauri resources");
    // Library test executables also need Common Controls v6, before main() runs.
    println!("cargo:rerun-if-changed=common-controls.rc");
    println!("cargo:rerun-if-changed=common-controls.manifest");
    embed_resource::compile_for_everything("common-controls.rc", embed_resource::NONE)
        .manifest_required()
        .expect("failed to embed Common Controls manifest");
}
