//! Локальный прокси внутри процесса Tune.
//!
//! WebView2 ходит в сеть из своих процессов msedgewebview2.exe, поэтому правило
//! маршрутизации по процессу (VPN, split tunneling) на tune-music.exe их не ловит.
//! Движку передаётся --proxy-server на этот прокси: все соединения открывает
//! tune-music.exe, и правило для него покрывает весь трафик клиента.
//!
//! Поддерживается то, что шлёт Chromium: CONNECT для HTTPS/WSS и обычные
//! HTTP-запросы в абсолютной форме. Слушает только 127.0.0.1.

use std::io::{self, BufRead, BufReader, Write};
use std::net::{Shutdown, TcpListener, TcpStream, ToSocketAddrs};
use std::thread;
use std::time::Duration;

/// Запускает прокси на случайном порту и возвращает его.
pub fn start() -> io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    thread::Builder::new().name("tune-proxy".into()).spawn(move || {
        for client in listener.incoming().flatten() {
            let _ = thread::Builder::new().name("tune-proxy-conn".into()).spawn(move || {
                let _ = handle(client);
            });
        }
    })?;
    Ok(port)
}

fn connect(target: &str) -> io::Result<TcpStream> {
    let mut last = io::Error::new(io::ErrorKind::NotFound, "адрес не найден");
    for addr in target.to_socket_addrs()? {
        match TcpStream::connect_timeout(&addr, Duration::from_secs(15)) {
            Ok(s) => {
                let _ = s.set_nodelay(true);
                return Ok(s);
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

fn handle(client: TcpStream) -> io::Result<()> {
    let _ = client.set_nodelay(true);
    let mut reader = BufReader::new(client.try_clone()?);
    let mut head = String::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(());
        }
        head.push_str(&line);
        if line == "\r\n" || line == "\n" {
            break;
        }
        if head.len() > 64 * 1024 {
            return Ok(());
        }
    }

    let mut parts = head.lines().next().unwrap_or("").split_whitespace();
    let method = parts.next().unwrap_or("");
    let uri = parts.next().unwrap_or("");
    let mut client_w = client;

    let upstream = if method.eq_ignore_ascii_case("CONNECT") {
        let target = if uri.contains(':') { uri.to_string() } else { format!("{uri}:443") };
        match connect(&target) {
            Ok(s) => {
                client_w.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")?;
                s
            }
            Err(_) => {
                let _ = client_w.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
                return Ok(());
            }
        }
    } else {
        // GET http://host[:port]/path HTTP/1.1 → пересылаем как есть, серверы принимают абсолютную форму.
        let Some(rest) = uri.strip_prefix("http://") else {
            let _ = client_w.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
            return Ok(());
        };
        let host = rest.split('/').next().unwrap_or("");
        let target = if host.contains(':') { host.to_string() } else { format!("{host}:80") };
        match connect(&target) {
            Ok(mut s) => {
                s.write_all(head.as_bytes())?;
                s
            }
            Err(_) => {
                let _ = client_w.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
                return Ok(());
            }
        }
    };

    // То, что клиент успел прислать сверх заголовков, уже лежит в буфере reader.
    let buffered = reader.buffer().to_vec();
    let mut up_w = upstream.try_clone()?;
    if !buffered.is_empty() {
        up_w.write_all(&buffered)?;
    }
    let mut up_r = upstream;
    let mut client_r = reader.into_inner();

    let t = thread::spawn(move || {
        let _ = io::copy(&mut client_r, &mut up_w);
        let _ = up_w.shutdown(Shutdown::Write);
    });
    let _ = io::copy(&mut up_r, &mut client_w);
    let _ = client_w.shutdown(Shutdown::Both);
    let _ = t.join();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn tunnels_connect() {
        // Эхо-сервер вместо внешнего сайта.
        let echo = TcpListener::bind("127.0.0.1:0").unwrap();
        let echo_port = echo.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut s, _) = echo.accept().unwrap();
            let mut buf = [0u8; 5];
            s.read_exact(&mut buf).unwrap();
            s.write_all(&buf).unwrap();
        });

        let port = start().unwrap();
        let mut c = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(c, "CONNECT 127.0.0.1:{echo_port} HTTP/1.1\r\nHost: x\r\n\r\nhello").unwrap();
        let mut resp = vec![0u8; "HTTP/1.1 200 Connection Established\r\n\r\n".len() + 5];
        c.read_exact(&mut resp).unwrap();
        assert!(String::from_utf8_lossy(&resp).ends_with("hello"));
    }
}
