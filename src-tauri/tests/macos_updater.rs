#![cfg(target_os = "macos")]

use std::{
    fs,
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    path::PathBuf,
    process::Command,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri_plugin_updater::UpdaterExt;

struct TestDirectory(PathBuf);

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn command(program: &str, args: &[&std::ffi::OsStr]) -> std::process::Output {
    let output = Command::new(program).args(args).output().unwrap();
    assert!(
        output.status.success(),
        "{program}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

#[test]
#[ignore = "requires a built macOS OTA package and its .sig in FOXBEAT_MACOS_UPDATER_ARCHIVE"]
fn signed_macos_ota_preserves_resource_seal_without_inheriting_quarantine() {
    let archive = PathBuf::from(std::env::var_os("FOXBEAT_MACOS_UPDATER_ARCHIVE").unwrap());
    let payload = fs::read(&archive).unwrap();
    let signature = fs::read_to_string(format!("{}.sig", archive.display())).unwrap();
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let mut context = mock_context(noop_assets());
    let mut plugin_config = config["plugins"]["updater"].clone();
    // HTTP is restricted to the loopback server in this test.
    plugin_config["dangerousInsecureTransportProtocol"] = true.into();
    context
        .config_mut()
        .plugins
        .0
        .insert("updater".into(), plugin_config);
    let app = mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let _ = rustls::crypto::ring::default_provider().install_default();
    let temporary = TestDirectory(std::env::temp_dir().join(format!(
        "foxbeat-ota-install-test-{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
    )));
    fs::create_dir(&temporary.0).unwrap();
    command(
        "tar",
        &[
            "-xzf".as_ref(),
            archive.as_os_str(),
            "-C".as_ref(),
            temporary.0.as_os_str(),
        ],
    );
    let installed = temporary.0.join("FoxBeat.app");
    command(
        "xattr",
        &[
            "-w".as_ref(),
            "com.apple.quarantine".as_ref(),
            "0083;00000000;FoxBeatTest;".as_ref(),
            installed.as_os_str(),
        ],
    );

    for _ in 0..2 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let manifest = serde_json::json!({
            "version": config["version"], "url": format!("{origin}/update"), "signature": signature.trim()
        })
        .to_string();
        let served_payload = payload.clone();
        let server = std::thread::spawn(move || {
            for body in [manifest.as_bytes(), served_payload.as_slice()] {
                let deadline = Instant::now() + Duration::from_secs(15);
                let mut socket = loop {
                    match listener.accept() {
                        Ok((socket, _)) => break socket,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            std::thread::sleep(Duration::from_millis(10));
                        }
                        Err(error) => panic!("test HTTP server: {error}"),
                    }
                };
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                socket
                    .set_write_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut reader = BufReader::new(socket.try_clone().unwrap());
                let mut line = String::new();
                loop {
                    line.clear();
                    if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                        break;
                    }
                }
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .unwrap();
                socket.write_all(body).unwrap();
            }
        });
        let result = tauri::async_runtime::block_on(async {
            let updater = app
                .updater_builder()
                .executable_path(installed.join("Contents/MacOS/foxbeat"))
                .endpoints(vec![format!("{origin}/latest.json").parse().unwrap()])
                .unwrap()
                .no_proxy()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap();
            let update = updater.check().await.unwrap().unwrap();
            let bytes = update.download(|_, _| {}, || {}).await.unwrap();
            update.install(bytes)
        });
        server.join().unwrap();
        result.unwrap();
        command(
            "codesign",
            &[
                "--verify".as_ref(),
                "--deep".as_ref(),
                "--strict".as_ref(),
                installed.as_os_str(),
            ],
        );
        assert!(installed
            .join("Contents/_CodeSignature/CodeResources")
            .is_file());
        let attrs = command("xattr", &["-rs".as_ref(), installed.as_os_str()]);
        assert!(!String::from_utf8_lossy(&attrs.stdout).contains("com.apple.quarantine"));
        let plist = command(
            "plutil",
            &[
                "-convert".as_ref(),
                "json".as_ref(),
                "-o".as_ref(),
                "-".as_ref(),
                installed.join("Contents/Info.plist").as_os_str(),
            ],
        );
        let info: serde_json::Value = serde_json::from_slice(&plist.stdout).unwrap();
        assert_eq!(info["CFBundleIdentifier"], config["identifier"]);
        assert_eq!(info["CFBundleShortVersionString"], config["version"]);
    }
}
