use crate::{control_only, open_main, save_moved_position, Core};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

const RELEASE_API: &str = "https://api.github.com/repos/manyou116/FoxBeat/releases?per_page=100";
const RELEASE_PREFIX: &str = "https://github.com/manyou116/FoxBeat/releases/";
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    pub revision: u64,
    pub phase: String,
    pub current_version: String,
    pub available_version: Option<String>,
    pub notes: String,
    pub release_url: Option<String>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
    pub can_install: bool,
    pub prompt: bool,
}

struct Inner {
    snapshot: UpdateSnapshot,
    pending: Option<Update>,
    dismissed_version: Option<String>,
    last_attempt: Option<Instant>,
}

pub struct UpdateManager(Mutex<Inner>);

impl UpdateManager {
    pub fn new(version: String) -> Self {
        Self(Mutex::new(Inner {
            snapshot: UpdateSnapshot {
                revision: 0,
                phase: "idle".into(),
                current_version: version,
                available_version: None,
                notes: String::new(),
                release_url: None,
                downloaded: 0,
                total: None,
                error: None,
                can_install: false,
                prompt: false,
            },
            pending: None,
            dismissed_version: None,
            last_attempt: None,
        }))
    }
}

#[derive(Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    body: Option<String>,
    html_url: String,
    assets: Vec<ReleaseAsset>,
}

fn latest_release<'a>(
    releases: &'a [Release],
    current: &Version,
    include_preview: bool,
) -> Option<&'a Release> {
    releases
        .iter()
        .filter_map(|release| {
            let version = Version::parse(release.tag_name.trim_start_matches('v')).ok()?;
            if release.draft
                || version <= *current
                || (!include_preview && (release.prerelease || !version.pre.is_empty()))
            {
                return None;
            }
            Some((version, release))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, release)| release)
}

fn busy(phase: &str) -> bool {
    matches!(phase, "checking" | "downloading" | "installing")
}

fn publish(app: &tauri::AppHandle, change: impl FnOnce(&mut Inner)) -> UpdateSnapshot {
    let manager = app.state::<UpdateManager>();
    let snapshot = {
        let mut inner = manager.0.lock().unwrap();
        change(&mut inner);
        inner.snapshot.revision += 1;
        inner.snapshot.clone()
    };
    let _ = app.emit_to("main", "foxbeat://update", &snapshot);
    snapshot
}

#[tauri::command]
pub fn get_update_state(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<UpdateSnapshot, String> {
    control_only(&window)?;
    Ok(app
        .state::<UpdateManager>()
        .0
        .lock()
        .unwrap()
        .snapshot
        .clone())
}

#[tauri::command]
pub async fn check_for_updates(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<UpdateSnapshot, String> {
    control_only(&window)?;
    Ok(check(app, true).await)
}

async fn discover(
    app: &tauri::AppHandle,
    include_preview: bool,
) -> Result<Option<(Release, Option<Update>)>, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .user_agent(concat!("FoxBeat/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "无法初始化更新连接")?;
    let response = client
        .get(RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "无法连接 GitHub，请检查网络后重试")?;
    if response.status() == reqwest::StatusCode::FORBIDDEN
        || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return Err("GitHub 暂时限制了检查频率，请稍后重试".into());
    }
    let releases: Vec<Release> = response
        .error_for_status()
        .map_err(|_| "暂时无法获取发布版本")?
        .json()
        .await
        .map_err(|_| "发布信息格式不正确")?;
    let current = app.package_info().version.clone();
    let Some(release) = latest_release(&releases, &current, include_preview) else {
        return Ok(None);
    };
    let release_tag = release.tag_name.clone();
    let release = releases
        .into_iter()
        .find(|release| release.tag_name == release_tag)
        .unwrap();
    if !release.html_url.starts_with(RELEASE_PREFIX) {
        return Err("更新来源不正确".into());
    }
    let Some(manifest) = release
        .assets
        .iter()
        .find(|asset| asset.name == "latest.json")
    else {
        return Ok(Some((release, None)));
    };
    if !manifest
        .browser_download_url
        .starts_with(&format!("{RELEASE_PREFIX}download/{release_tag}/"))
    {
        return Err("更新清单来源不正确".into());
    }
    let cleanup_app = app.clone();
    let updater = app
        .updater_builder()
        .endpoints(vec![manifest
            .browser_download_url
            .parse()
            .map_err(|_| "更新地址不正确")?])
        .map_err(|_| "更新地址不正确")?
        .timeout(Duration::from_secs(20))
        .restart_after_install(true)
        .on_before_exit(move || {
            let core = cleanup_app.state::<Core>();
            let _ = save_moved_position(&core, true);
            core.input.stop();
            cleanup_app.cleanup_before_exit();
        })
        .build()
        .map_err(|_| "更新器配置不正确")?;
    let mut update = updater
        .check()
        .await
        .map_err(|_| "无法获取适用于这台电脑的更新，请重试或下载安装包")?
        .ok_or_else(|| "更新清单与发布版本不同".to_string())?;
    if update.version != release_tag.trim_start_matches('v')
        || !update
            .download_url
            .as_str()
            .starts_with(&format!("{RELEASE_PREFIX}download/{release_tag}/"))
    {
        return Err("更新包与发布版本不同".into());
    }
    update.timeout = Some(Duration::from_secs(15 * 60));
    Ok(Some((release, Some(update))))
}

pub async fn check(app: tauri::AppHandle, manual: bool) -> UpdateSnapshot {
    let manager = app.state::<UpdateManager>();
    let include_preview = app
        .state::<Core>()
        .stored
        .lock()
        .unwrap()
        .settings
        .preview_updates;
    {
        let mut inner = manager.0.lock().unwrap();
        if busy(&inner.snapshot.phase)
            || (!manual
                && inner
                    .last_attempt
                    .is_some_and(|at| at.elapsed() < CHECK_INTERVAL))
        {
            return inner.snapshot.clone();
        }
        inner.last_attempt = Some(Instant::now());
        inner.snapshot.phase = "checking".into();
        inner.snapshot.error = None;
        inner.snapshot.prompt = false;
        inner.snapshot.available_version = None;
        inner.snapshot.release_url = None;
        inner.snapshot.notes.clear();
        inner.snapshot.downloaded = 0;
        inner.snapshot.total = None;
        inner.snapshot.can_install = false;
        inner.pending = None;
    }
    publish(&app, |_| {});
    match discover(&app, include_preview).await {
        Ok(Some((release, update))) => {
            let installable =
                update.is_some() && !cfg!(debug_assertions) && !app.state::<Core>().preview;
            let version = release.tag_name.trim_start_matches('v').to_string();
            let automatic = app
                .state::<Core>()
                .stored
                .lock()
                .unwrap()
                .settings
                .automatic_update_checks;
            let snapshot = publish(&app, |inner| {
                inner.snapshot.phase = "available".into();
                inner.snapshot.available_version = Some(version.clone());
                inner.snapshot.notes = release.body.unwrap_or_default();
                inner.snapshot.release_url = Some(release.html_url);
                inner.snapshot.can_install = installable;
                inner.snapshot.prompt =
                    manual || (automatic && inner.dismissed_version.as_ref() != Some(&version));
                inner.pending = update;
            });
            if snapshot.prompt {
                open_main(&app);
            }
            snapshot
        }
        Ok(None) => publish(&app, |inner| {
            inner.pending = None;
            inner.snapshot.phase = "current".into();
            inner.snapshot.available_version = None;
            inner.snapshot.release_url = None;
            inner.snapshot.notes.clear();
            inner.snapshot.can_install = false;
        }),
        Err(error) => publish(&app, |inner| {
            inner.snapshot.phase = "error".into();
            inner.snapshot.error = Some(error);
            inner.snapshot.can_install = false;
            inner.pending = None;
        }),
    }
}

#[tauri::command]
pub fn dismiss_update(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<UpdateSnapshot, String> {
    control_only(&window)?;
    let snapshot = {
        let manager = app.state::<UpdateManager>();
        let mut inner = manager.0.lock().unwrap();
        if busy(&inner.snapshot.phase) {
            return Err("更新正在进行".into());
        }
        inner.dismissed_version = inner.snapshot.available_version.clone();
        inner.snapshot.prompt = false;
        inner.snapshot.revision += 1;
        inner.snapshot.clone()
    };
    let _ = app.emit_to("main", "foxbeat://update", &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<UpdateSnapshot, String> {
    control_only(&window)?;
    if cfg!(debug_assertions) || app.state::<Core>().preview {
        return Err("开发或预览模式不能安装更新，请使用发布版客户端".into());
    }
    let update = {
        let manager = app.state::<UpdateManager>();
        let mut inner = manager.0.lock().unwrap();
        if busy(&inner.snapshot.phase) {
            return Err("更新正在进行".into());
        }
        let update = inner.pending.clone().ok_or("请先检查新版本")?;
        inner.snapshot.phase = "downloading".into();
        inner.snapshot.error = None;
        inner.snapshot.downloaded = 0;
        inner.snapshot.total = None;
        inner.snapshot.prompt = true;
        update
    };
    publish(&app, |_| {});
    let progress_app = app.clone();
    let mut last_emit = Instant::now();
    let mut downloaded = 0u64;
    let download = update
        .download(
            move |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let manager = progress_app.state::<UpdateManager>();
                let mut inner = manager.0.lock().unwrap();
                inner.snapshot.downloaded = downloaded;
                inner.snapshot.total = total;
                drop(inner);
                if last_emit.elapsed() >= Duration::from_millis(120) {
                    publish(&progress_app, |_| {});
                    last_emit = Instant::now();
                }
            },
            || {},
        )
        .await;
    let bytes = match download {
        Ok(bytes) => bytes,
        Err(_) => {
            return Ok(publish(&app, |inner| {
                inner.snapshot.phase = "error".into();
                inner.snapshot.error =
                    Some("下载或签名校验失败，未安装更新。请重试或下载安装包。".into());
            }))
        }
    };
    if let Err(error) = save_moved_position(&app.state::<Core>(), true) {
        return Ok(publish(&app, |inner| {
            inner.snapshot.phase = "error".into();
            inner.snapshot.error = Some(error);
        }));
    }
    publish(&app, |inner| inner.snapshot.phase = "installing".into());
    let result = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
    match result {
        Ok(Ok(())) => {
            app.state::<Core>().input.stop();
            app.restart();
        }
        _ => Ok(publish(&app, |inner| {
            inner.snapshot.phase = "error".into();
            inner.snapshot.error = Some("安装更新未完成，请重试或下载安装包。".into());
        })),
    }
}

#[tauri::command]
pub fn open_update_release(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    control_only(&window)?;
    let url = app
        .state::<UpdateManager>()
        .0
        .lock()
        .unwrap()
        .snapshot
        .release_url
        .clone()
        .unwrap_or_else(|| format!("{RELEASE_PREFIX}"));
    if !url.starts_with(RELEASE_PREFIX) {
        return Err("发布地址不正确".into());
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|_| "无法打开浏览器")?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(url)
        .spawn()
        .map_err(|_| "无法打开浏览器")?;
    Ok(())
}

pub fn start_automatic_checks(app: tauri::AppHandle) {
    // Native scheduling keeps checking when the control WebView is hidden.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(15));
        loop {
            let core = app.state::<Core>();
            let enabled = core.stored.lock().unwrap().settings.automatic_update_checks;
            if enabled && !core.preview && !cfg!(debug_assertions) {
                let queued = app.clone();
                tauri::async_runtime::spawn(check(queued, false));
            }
            std::thread::sleep(Duration::from_secs(60));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn release(tag: &str, draft: bool, prerelease: bool) -> Release {
        Release {
            tag_name: tag.into(),
            draft,
            prerelease,
            body: None,
            html_url: format!("{RELEASE_PREFIX}tag/{tag}"),
            assets: vec![],
        }
    }
    #[test]
    fn compares_semantic_versions_and_ignores_drafts_downgrades_and_invalid_tags() {
        let releases = vec![
            release("v0.1.9", false, false),
            release("v0.1.10", false, false),
            release("v9.0.0", true, false),
            release("nightly", false, false),
            release("v0.1.1", false, false),
        ];
        assert_eq!(
            latest_release(&releases, &Version::new(0, 1, 1), true)
                .unwrap()
                .tag_name,
            "v0.1.10"
        );
        assert!(latest_release(&releases, &Version::new(0, 1, 10), true).is_none());
    }
    #[test]
    fn respects_preview_channel() {
        let releases = vec![
            release("v0.2.0", false, true),
            release("v0.1.2", false, false),
            release("v0.3.0-beta.1", false, false),
        ];
        assert_eq!(
            latest_release(&releases, &Version::new(0, 1, 1), false)
                .unwrap()
                .tag_name,
            "v0.1.2"
        );
        assert_eq!(
            latest_release(&releases, &Version::new(0, 1, 1), true)
                .unwrap()
                .tag_name,
            "v0.3.0-beta.1"
        );
    }

    #[test]
    fn downloads_verified_bytes_and_rejects_tampering_and_mismatched_signed_versions() {
        use std::{
            io::{BufRead, BufReader, Write},
            net::TcpListener,
        };
        use tauri::test::{mock_builder, mock_context, noop_assets};
        const PAYLOAD: &[u8] = include_bytes!("../tests/fixtures/updater-payload.txt");
        const SIGNATURE: &str = include_str!("../tests/fixtures/updater-payload.txt.sig");
        let _ = rustls::crypto::ring::default_provider().install_default();
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mut context = mock_context(noop_assets());
        let mut plugin_config = config["plugins"]["updater"].clone();
        // Only this loopback test server uses HTTP; production requires HTTPS.
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
        for (version, payload, succeeds) in [
            ("0.1.2", PAYLOAD, true),
            ("0.1.2", b"tampered".as_slice(), false),
            ("0.1.3", PAYLOAD, false),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let origin = format!("http://{}", listener.local_addr().unwrap());
            let manifest = serde_json::json!({"version": version, "url": format!("{origin}/update"), "signature": SIGNATURE.trim()}).to_string();
            let server = std::thread::spawn(move || {
                for body in [manifest.as_bytes(), payload] {
                    let deadline = Instant::now() + Duration::from_secs(10);
                    let mut socket = loop {
                        match listener.accept() {
                            Ok((socket, _)) => break socket,
                            Err(error)
                                if error.kind() == std::io::ErrorKind::WouldBlock
                                    && Instant::now() < deadline =>
                            {
                                std::thread::sleep(Duration::from_millis(10))
                            }
                            Err(error) => panic!("test HTTP server: {error}"),
                        }
                    };
                    socket
                        .set_read_timeout(Some(Duration::from_secs(5)))
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
                    .endpoints(vec![format!("{origin}/latest.json").parse().unwrap()])
                    .unwrap()
                    .no_proxy()
                    .timeout(Duration::from_secs(5))
                    .build()
                    .unwrap();
                let update = updater.check().await.unwrap().unwrap();
                let mut received = 0;
                let bytes = update.download(|chunk, _| received += chunk, || {}).await;
                assert_eq!(received, payload.len());
                bytes
            });
            server.join().unwrap();
            if succeeds {
                assert_eq!(result.unwrap(), PAYLOAD);
            } else {
                assert!(
                    result.is_err(),
                    "must not accept tampered bytes or a mismatched signed version"
                );
            }
        }
    }
}
