//! Яндекс Станции и колонки в локальной сети (протокол Glagol).
//!
//! Устройства и их токены отдаёт аккаунт (quasar.yandex.net), адрес — mDNS, команды идут
//! напрямую в колонку по wss. Сертификат у колонки самоподписанный, поэтому сверяем его
//! с тем, что аккаунт публикует для этого устройства. Состояние уходит в страницу
//! событием tune:station.
//!
//! Загруженных треков нет в каталоге, и номером их колонке не назвать. Такой файл Tune
//! отдаёт ей сам: по http в локальной сети, по случайной ссылке, только пока он играет.
//!
//! Токен страницы Музыки quasar не принимает, поэтому для Станций отдельный вход по коду
//! на ya.ru/device. Токен лежит в файле и в страницу не попадает: её делят с аддонами.

use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{ring, verify_tls12_signature, verify_tls13_signature, WebPkiSupportedAlgorithms};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, SignatureScheme, StreamOwned};
use serde::Serialize;
use serde_json::{json, Value};
use tungstenite::{Error as WsError, Message, WebSocket};

/// Приложение Яндекс Музыки: только его токены принимает quasar. Данные общеизвестны,
/// их используют открытые клиенты (MarshalX/yandex-music-api).
const CLIENT_ID: &str = "23cabbbdc6cd418abb4b39c32c41195d";
const CLIENT_SECRET: &str = "53bc75238f0c4d08a118e51fe9203300";
/// Ответ странице: нужен вход.
pub const NEED_LOGIN: &str = "NEED_LOGIN";

const SERVICE: &str = "_yandexio._tcp.local.";
const SCAN: Duration = Duration::from_secs(2);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(200);
const KEEPALIVE: Duration = Duration::from_secs(30);
const REPORT_EVERY: Duration = Duration::from_secs(1);
const FILE_WAIT: Duration = Duration::from_secs(4);

#[derive(Clone, Serialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub platform: String,
    /// Откликнулась в локальной сети.
    pub online: bool,
    /// Отвечает в сети, но в аккаунте, под которым вошли, её нет — управлять нельзя.
    pub foreign: bool,
    #[serde(skip)]
    addrs: Vec<SocketAddr>,
    #[serde(skip)]
    cert: String,
}

/// Устройства из последнего поиска: страница называет только id, адрес и сертификат — наши.
static DEVICES: Mutex<Vec<Device>> = Mutex::new(Vec::new());
/// Номер подключения и его канал команд; канал закрылся — поток колонки завершается.
static SESSION: Mutex<Option<(u64, Sender<Value>)>> = Mutex::new(None);
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
/// Адрес подключённой колонки: файл отдаём с того интерфейса, что смотрит на неё.
static PEER: Mutex<Option<SocketAddr>> = Mutex::new(None);
/// Номер последней команды «играй»: пока файл качался, могли включить другой трек.
static PLAY: AtomicU64 = AtomicU64::new(0);

struct Served {
    path: String,
    mime: &'static str,
    bytes: Vec<u8>,
    /// Сколько раз колонка пришла за файлом: ноль — её не пропустил брандмауэр.
    hits: AtomicU64,
}
static SERVED: Mutex<Option<Arc<Served>>> = Mutex::new(None);
static SERVER: Mutex<Option<(IpAddr, u16)>> = Mutex::new(None);
/// Колонка уже не смогла прийти за файлом: следующие незашифрованные сразу по прямой ссылке.
static LAN_BLOCKED: AtomicBool = AtomicBool::new(false);

struct Login {
    device_code: String,
    url: String,
}
static LOGIN: Mutex<Option<Login>> = Mutex::new(None);

fn token_path(root: &Path) -> PathBuf {
    root.join("station-token")
}

fn load_token(root: &Path) -> Result<String, String> {
    let token = std::fs::read_to_string(token_path(root)).unwrap_or_default();
    let token = token.trim();
    if token.is_empty() {
        return Err(NEED_LOGIN.into());
    }
    Ok(token.to_string())
}

/// Начинает вход: код для ya.ru/device и как часто спрашивать о подтверждении, в секундах.
pub fn login_start() -> Result<Value, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(10))).build().into();
    let body = agent
        .post("https://oauth.yandex.ru/device/code")
        .send_form([("client_id", CLIENT_ID), ("device_name", "Tune")])
        .map_err(|e| format!("Не удалось связаться с Яндексом: {e}"))?
        .into_body()
        .read_to_string()
        .map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let (Some(device_code), Some(code), Some(url)) = (v["device_code"].as_str(), v["user_code"].as_str(), v["verification_url"].as_str()) else {
        return Err("Яндекс не выдал код входа".into());
    };
    *LOGIN.lock().unwrap() = Some(Login { device_code: device_code.to_string(), url: url.to_string() });
    Ok(json!({ "code": code, "interval": v["interval"].as_u64().unwrap_or(5) }))
}

/// Адрес страницы подтверждения: его дал Яндекс, страница только просит открыть.
pub fn login_url() -> Option<String> {
    LOGIN.lock().unwrap().as_ref().map(|l| l.url.clone()).filter(|u| u.starts_with("https://"))
}

/// true — вход подтверждён и токен сохранён, false — ещё ждём.
pub fn login_poll(root: &Path) -> Result<bool, String> {
    let device_code = LOGIN.lock().unwrap().as_ref().map(|l| l.device_code.clone()).ok_or("Вход не начат")?;
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(10))).http_status_as_error(false).build().into();
    let body = agent
        .post("https://oauth.yandex.ru/token")
        .send_form([("grant_type", "device_code"), ("code", device_code.as_str()), ("client_id", CLIENT_ID), ("client_secret", CLIENT_SECRET)])
        .map_err(|e| format!("Не удалось связаться с Яндексом: {e}"))?
        .into_body()
        .read_to_string()
        .map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    if let Some(token) = v["access_token"].as_str() {
        std::fs::write(token_path(root), token).map_err(|e| e.to_string())?;
        *LOGIN.lock().unwrap() = None;
        return Ok(true);
    }
    match v["error"].as_str() {
        Some("authorization_pending") => Ok(false),
        Some("expired_token") => Err("Код устарел, войдите ещё раз".into()),
        _ => Err("Яндекс не подтвердил вход".into()),
    }
}

pub fn logout(root: &Path) {
    disconnect();
    let _ = std::fs::remove_file(token_path(root));
}

fn get_json(url: &str, query: &[(&str, &str)], token: &str) -> Result<Value, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(10))).build().into();
    let mut req = agent.get(url).header("Authorization", &format!("OAuth {token}"));
    for (k, v) in query {
        req = req.query(*k, *v);
    }
    let body = req
        .call()
        .map_err(|e| match e {
            // Токен отозвали или он истёк.
            ureq::Error::StatusCode(401 | 403) => NEED_LOGIN.to_string(),
            e => format!("Не удалось связаться с Яндексом: {e}"),
        })?
        .into_body()
        .read_to_string()
        .map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    if v["status"] != "ok" {
        return Err("Яндекс вернул ошибку".into());
    }
    Ok(v)
}

/// id устройства → модель и адреса из mDNS. Колонок может не быть, а сеть — не пускать multicast.
fn scan() -> HashMap<String, (String, Vec<SocketAddr>)> {
    let mut found = HashMap::new();
    let Ok(daemon) = mdns_sd::ServiceDaemon::new() else { return found };
    let Ok(events) = daemon.browse(SERVICE) else { return found };
    let until = Instant::now() + SCAN;
    while let Some(left) = until.checked_duration_since(Instant::now()) {
        let Ok(ev) = events.recv_timeout(left) else { break };
        if let mdns_sd::ServiceEvent::ServiceResolved(info) = ev {
            if let Some(id) = info.get_property_val_str("deviceId") {
                let addrs = info.get_addresses_v4().into_iter().map(|ip| SocketAddr::from((*ip, info.get_port()))).collect();
                let platform = info.get_property_val_str("platform").unwrap_or_default().to_string();
                found.insert(id.to_string(), (platform, addrs));
            }
        }
    }
    let _ = daemon.shutdown();
    found
}

pub fn list(root: &Path) -> Result<Vec<Device>, String> {
    let token = load_token(root)?;
    let (cloud, local) = std::thread::scope(|s| {
        let local = s.spawn(scan);
        (get_json("https://quasar.yandex.net/glagol/device_list", &[], &token), local.join().unwrap_or_default())
    });
    let mut devices = Vec::new();
    for d in cloud?["devices"].as_array().into_iter().flatten() {
        // В списке есть и телефоны с камерами — у них нет сертификата Glagol.
        let (Some(id), Some(cert)) = (d["id"].as_str(), d["glagol"]["security"]["server_certificate"].as_str()) else { continue };
        let net = &d["networkInfo"];
        let port = net["external_port"].as_u64().and_then(|p| u16::try_from(p).ok()).unwrap_or(1961);
        let known = net["ip_addresses"].as_array().into_iter().flatten().filter_map(|ip| ip.as_str()?.parse().ok()).map(|ip| SocketAddr::new(ip, port));
        let heard = local.get(id).map(|(_, addrs)| addrs);
        // Сначала то, что ответило только что: адрес из аккаунта мог устареть.
        let addrs: Vec<SocketAddr> = heard.into_iter().flatten().copied().chain(known).collect();
        if addrs.is_empty() {
            continue;
        }
        devices.push(Device {
            id: id.to_string(),
            name: d["name"].as_str().unwrap_or("Станция").to_string(),
            platform: d["platform"].as_str().unwrap_or_default().to_string(),
            online: heard.is_some_and(|a| !a.is_empty()),
            foreign: false,
            addrs,
            cert: cert.to_string(),
        });
    }
    *DEVICES.lock().unwrap() = devices.clone();
    for (id, (platform, _)) in &local {
        if !devices.iter().any(|d| &d.id == id) {
            devices.push(Device {
                id: id.clone(),
                name: "Станция".to_string(),
                platform: platform.clone(),
                online: true,
                foreign: true,
                addrs: Vec::new(),
                cert: String::new(),
            });
        }
    }
    Ok(devices)
}

#[derive(Debug)]
struct PinnedCert {
    der: Vec<u8>,
    algs: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for PinnedCert {
    fn verify_server_cert(&self, end_entity: &CertificateDer<'_>, _: &[CertificateDer<'_>], _: &ServerName<'_>, _: &[u8], _: UnixTime) -> Result<ServerCertVerified, rustls::Error> {
        // Срок не проверяем: колонки живут и с давно истёкшими сертификатами.
        if end_entity.as_ref() == self.der {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General("сертификат не совпал с аккаунтом".into()))
        }
    }
    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.algs)
    }
    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.algs)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algs.supported_schemes()
    }
}

type Socket = WebSocket<StreamOwned<ClientConnection, TcpStream>>;

fn open(device: &Device) -> Result<Socket, String> {
    let der = CertificateDer::from_pem_slice(device.cert.as_bytes()).map_err(|e| format!("Сертификат устройства: {e}"))?;
    let provider = ring::default_provider();
    let algs = provider.signature_verification_algorithms;
    let config = ClientConfig::builder_with_provider(Arc::new(provider))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinnedCert { der: der.as_ref().to_vec(), algs }))
        .with_no_client_auth();
    let config = Arc::new(config);
    let mut last = String::from("нет адреса");
    for addr in &device.addrs {
        let attempt = (|| -> Result<Socket, String> {
            let tcp = TcpStream::connect_timeout(addr, CONNECT_TIMEOUT).map_err(|e| e.to_string())?;
            tcp.set_read_timeout(Some(CONNECT_TIMEOUT)).map_err(|e| e.to_string())?;
            tcp.set_write_timeout(Some(CONNECT_TIMEOUT)).map_err(|e| e.to_string())?;
            // В сертификате колонки всегда localhost; подлинность проверяет сверка выше.
            let name = ServerName::try_from("localhost").map_err(|e| e.to_string())?;
            let conn = ClientConnection::new(config.clone(), name).map_err(|e| e.to_string())?;
            let (ws, _) = tungstenite::client(format!("wss://{addr}/"), StreamOwned::new(conn, tcp)).map_err(|e| e.to_string())?;
            ws.get_ref().sock.set_read_timeout(Some(POLL)).map_err(|e| e.to_string())?;
            Ok(ws)
        })();
        match attempt {
            Ok(ws) => return Ok(ws),
            Err(e) => last = e,
        }
    }
    Err(format!("{} не отвечает: {last}", device.name))
}

fn frame(token: &str, payload: Value) -> Message {
    let id = format!("{:x}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos());
    let sent = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    Message::text(json!({ "conversationToken": token, "id": id, "payload": payload, "sentTime": sent }).to_string())
}

/// Из потока состояний колонки — только то, что показывает страница.
fn status(raw: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let state = v.get("state")?;
    let p = &state["playerState"];
    Some(json!({
        "state": "status",
        "playing": state["playing"],
        "volume": state["volume"],
        "id": p["id"],
        "title": p["title"],
        "subtitle": p["subtitle"],
        "progress": p["progress"],
        "duration": p["duration"],
    }))
}

fn pump(mut ws: Socket, token: &str, commands: mpsc::Receiver<Value>, report: &dyn Fn(Value)) -> Result<(), String> {
    ws.send(frame(token, json!({ "command": "softwareVersion" }))).map_err(|e| e.to_string())?;
    let mut last_ping = Instant::now();
    let mut last_report: Option<Instant> = None;
    loop {
        loop {
            match commands.try_recv() {
                Ok(payload) => ws.send(frame(token, payload)).map_err(|e| e.to_string())?,
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    let _ = ws.close(None);
                    return Ok(());
                }
            }
        }
        if last_ping.elapsed() >= KEEPALIVE {
            ws.send(frame(token, json!({ "command": "ping" }))).map_err(|e| e.to_string())?;
            last_ping = Instant::now();
        }
        match ws.read() {
            Ok(Message::Text(text)) => {
                if last_report.is_none_or(|t| t.elapsed() >= REPORT_EVERY) {
                    if let Some(s) = status(text.as_str()) {
                        report(s);
                        last_report = Some(Instant::now());
                    }
                }
            }
            Ok(_) => {}
            Err(WsError::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Подключается к колонке в фоне. Прежнее подключение закрывается.
pub fn connect(root: &Path, id: &str, report: impl Fn(Value) + Send + 'static) -> Result<(), String> {
    let token = load_token(root)?;
    let device = DEVICES.lock().unwrap().iter().find(|d| d.id == id).cloned().ok_or("Устройство не найдено, обновите список")?;
    let (tx, rx) = mpsc::channel();
    let number = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    *SESSION.lock().unwrap() = Some((number, tx));
    std::thread::spawn(move || {
        let result = (|| {
            let conv = get_json("https://quasar.yandex.net/glagol/token", &[("device_id", &device.id), ("platform", &device.platform)], &token)?;
            let conv = conv["token"].as_str().ok_or("Яндекс не выдал токен устройства")?.to_string();
            let ws = open(&device)?;
            *PEER.lock().unwrap() = ws.get_ref().sock.peer_addr().ok();
            report(json!({ "state": "connected", "id": device.id, "name": device.name }));
            pump(ws, &conv, rx, &report)
        })();
        // Пока подключались, могли выбрать другую колонку — её событий не перебиваем.
        let mut session = SESSION.lock().unwrap();
        let current = session.as_ref().is_some_and(|(n, _)| *n == number);
        if current {
            *session = None;
            drop(session);
            report(json!({ "state": "closed", "error": result.err() }));
        }
    });
    Ok(())
}

pub fn disconnect() {
    // Команды из канала поток успевает отправить и после его закрытия.
    if let Some((_, session)) = SESSION.lock().unwrap().take() {
        let _ = session.send(json!({ "command": "stop" }));
    }
    *SERVED.lock().unwrap() = None;
}

fn random_hex() -> String {
    let part = || RandomState::new().build_hasher().finish();
    format!("{:016x}{:016x}", part(), part())
}

fn respond(mut conn: TcpStream) -> std::io::Result<()> {
    conn.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut head = Vec::new();
    let mut buf = [0u8; 1024];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = conn.read(&mut buf)?;
        if n == 0 || head.len() > 16 * 1024 {
            return Ok(());
        }
        head.extend_from_slice(&buf[..n]);
    }
    let head = String::from_utf8_lossy(&head);
    let mut first = head.lines().next().unwrap_or_default().split(' ');
    let (method, path) = (first.next().unwrap_or_default(), first.next().unwrap_or_default());
    let served = SERVED.lock().unwrap().clone().filter(|s| s.path == path);
    let Some(served) = served.filter(|_| matches!(method, "GET" | "HEAD")) else {
        return conn.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    };
    served.hits.fetch_add(1, Ordering::Relaxed);
    let total = served.bytes.len();
    let range = head.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        if !k.eq_ignore_ascii_case("range") {
            return None;
        }
        let (from, to) = v.trim().strip_prefix("bytes=")?.split_once('-')?;
        let from: usize = from.parse().ok()?;
        let to = to.parse().ok().map_or(total.saturating_sub(1), |t: usize| t.min(total.saturating_sub(1)));
        (from <= to && to < total).then_some((from, to))
    });
    let (status, from, to) = match range {
        Some((a, b)) => ("206 Partial Content", a, b + 1),
        None => ("200 OK", 0, total),
    };
    let extra = range.map_or(String::new(), |(a, b)| format!("Content-Range: bytes {a}-{b}/{total}\r\n"));
    let reply = format!("HTTP/1.1 {status}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\n{extra}Connection: close\r\n\r\n", served.mime, to - from);
    conn.write_all(reply.as_bytes())?;
    if method == "GET" {
        conn.write_all(&served.bytes[from..to])?;
    }
    Ok(())
}

/// Сервер на адресе, с которого видно колонку; адрес и порт — для ссылки.
fn serve_on(peer: SocketAddr) -> Result<(IpAddr, u16), String> {
    let probe = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    probe.connect(peer).map_err(|e| e.to_string())?;
    let ip = probe.local_addr().map_err(|e| e.to_string())?.ip();
    let mut server = SERVER.lock().unwrap();
    if let Some(known) = server.filter(|(known, _)| *known == ip) {
        return Ok(known);
    }
    let listener = TcpListener::bind((ip, 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            std::thread::spawn(move || {
                let _ = respond(conn);
            });
        }
    });
    *server = Some((ip, port));
    Ok((ip, port))
}

fn varint(out: &mut Vec<u8>, mut n: usize) {
    while n >= 0x80 {
        out.push((n as u8 & 0x7f) | 0x80);
        n >>= 7;
    }
    out.push(n as u8);
}

/// Команда колонке в обход Алисы: protobuf из двух строк (имя и JSON), в base64.
fn external_command(name: &str, payload: &Value) -> Value {
    use base64::Engine;
    let mut data = Vec::new();
    for (tag, value) in [(0x0a, name.to_string()), (0x12, payload.to_string())] {
        data.push(tag);
        varint(&mut data, value.len());
        data.extend_from_slice(value.as_bytes());
    }
    json!({ "command": "externalCommandBypass", "data": base64::engine::general_purpose::STANDARD.encode(data) })
}

pub struct FileTrack {
    pub id: String,
    pub url: String,
    pub key: Option<String>,
    pub codec: String,
    pub title: String,
    pub artist: String,
    pub cover: String,
    /// С какого места играть, в миллисекундах.
    pub offset_ms: u64,
}

fn send_payload(payload: Value) -> Result<(), String> {
    let session = SESSION.lock().unwrap();
    session.as_ref().ok_or("Устройство не подключено")?.1.send(payload).map_err(|e| e.to_string())
}

/// Играет файл трека: качает его, отдаёт по локальной сети и даёт колонке ссылку. Если
/// за файлом никто не пришёл (входящие закрыты брандмауэром), незашифрованный файл
/// колонка может взять прямо с сервера Яндекса.
pub fn play_file(track: FileTrack, report: impl Fn(Value)) -> Result<(), String> {
    if !crate::download::allowed_url(&track.url) {
        return Err("Этот файл колонке не передать".into());
    }
    let number = PLAY.fetch_add(1, Ordering::Relaxed) + 1;
    let peer = (*PEER.lock().unwrap()).ok_or("Устройство не подключено")?;
    let separator = if track.url.contains('?') { '&' } else { '?' };
    let mut metadata = json!({ "title": track.title, "subtitle": track.artist });
    if track.cover.starts_with("https://") {
        metadata["art_image_url"] = json!(track.cover);
    }
    // format — только значение из списка: кодек колонка определяет сама.
    let command = |url: &str| external_command("audio_play", &json!({ "stream": { "id": track.id, "url": url, "format": "MP3", "type": "Track", "offset_ms": track.offset_ms }, "metadata": metadata }));
    let direct = |ext: &str| -> Result<(), String> {
        send_payload(command(&format!("{}{separator}tune=.{ext}", track.url)))?;
        report(json!({ "state": "file", "via": "direct" }));
        Ok(())
    };
    if track.key.is_none() && LAN_BLOCKED.load(Ordering::Relaxed) {
        return direct(match track.codec.as_str() {
            "mp3" => "mp3",
            "flac" => "flac",
            "aac" | "he-aac" => "aac",
            _ => "mp4",
        });
    }
    let bytes = crate::download::fetch_bytes(&track.url, track.key.as_deref())?;
    if PLAY.load(Ordering::Relaxed) != number {
        return Ok(());
    }
    // Без расширения в ссылке колонка файл не играет.
    let (ext, mime) = match track.codec.as_str() {
        "mp3" => ("mp3", "audio/mpeg"),
        "flac" => ("flac", "audio/flac"),
        "aac" | "he-aac" => ("aac", "audio/aac"),
        _ => ("mp4", "audio/mp4"),
    };
    let (ip, port) = serve_on(peer)?;
    let path = format!("/{}.{ext}", random_hex());
    let url = format!("http://{}{path}", SocketAddr::new(ip, port));
    let served = Arc::new(Served { path, mime, bytes, hits: AtomicU64::new(0) });
    *SERVED.lock().unwrap() = Some(served.clone());
    send_payload(command(&url))?;
    let until = Instant::now() + FILE_WAIT;
    while Instant::now() < until {
        if PLAY.load(Ordering::Relaxed) != number {
            return Ok(());
        }
        if served.hits.load(Ordering::Relaxed) > 0 {
            report(json!({ "state": "file", "via": "lan" }));
            return Ok(());
        }
        std::thread::sleep(POLL);
    }
    if track.key.is_some() {
        report(json!({ "state": "file", "via": "none" }));
        return Ok(());
    }
    LAN_BLOCKED.store(true, Ordering::Relaxed);
    direct(ext)
}

/// Только команды плеера: страницу делят с аддонами, остальное колонке от них не нужно.
pub fn send(command: &str, value: &Value) -> Result<(), String> {
    let payload = match command {
        "play" | "stop" => json!({ "command": command }),
        "rewind" => json!({ "command": "rewind", "position": value.as_f64().ok_or("Нужна позиция")?.max(0.0) }),
        "setVolume" => json!({ "command": "setVolume", "volume": value.as_f64().ok_or("Нужна громкость")?.clamp(0.0, 1.0) }),
        "playMusic" => {
            PLAY.fetch_add(1, Ordering::Relaxed);
            let id = value.as_str().filter(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit())).ok_or("Нужен id трека")?;
            json!({ "command": "playMusic", "id": id, "type": "track" })
        }
        _ => return Err("Неизвестная команда".into()),
    };
    let session = SESSION.lock().unwrap();
    session.as_ref().ok_or("Устройство не подключено")?.1.send(payload).map_err(|e| e.to_string())
}
