fn main() {
    let package_path = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../../package.json");
    // Absolute input identity matters when native and synthetic crates share a target cache.
    println!("cargo:rerun-if-changed={}", package_path.display());
    let package: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(package_path).unwrap()).unwrap();
    println!(
        "cargo:rustc-env=KEYLOOM_RELEASE={}",
        package["version"].as_str().unwrap()
    );
    println!(
        "cargo:rustc-env=KEYLOOM_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
}
