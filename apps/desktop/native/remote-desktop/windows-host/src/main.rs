mod approval;
mod capture;
mod capture_protocol;
mod cursor;
#[cfg(feature = "development")]
mod development;
mod installation;
mod legacy_cleanup;
mod pipe;
mod security;
mod service;
mod win;
use win::*;

fn service_name() -> Result<String> {
    Ok(installation::Installation::current()?.name)
}
fn pipe_name() -> Result<String> {
    Ok(installation::Installation::current()?.pipe())
}
fn isolate_search_path() {
    unsafe {
        windows_sys::Win32::System::LibraryLoader::SetDllDirectoryW([0u16].as_ptr());
        windows_sys::Win32::System::LibraryLoader::SetDefaultDllDirectories(
            windows_sys::Win32::System::LibraryLoader::LOAD_LIBRARY_SEARCH_SYSTEM32,
        );
    }
}

fn run() -> Result<()> {
    isolate_search_path();
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        #[cfg(feature = "development")]
        Some("--check-client") if args.len() == 2 => {
            approval::Approval::for_client(args[1].parse::<u32>().map_err(|_| error())?)?;
            println!("ready");
            Ok(())
        }
        Some("--service") => service::run(),
        Some("--worker") if args.len() == 2 => service::worker(&args[1]),
        Some("--install") if args.len() == 2 => {
            let pid = args[1].parse::<u32>().map_err(|_| error())?;
            approval::install(pid)
        }
        Some("--uninstall") => approval::remove(),
        Some("--elevate-install") if args.len() == 2 => {
            let pid = args[1].parse::<u32>().map_err(|_| error())?;
            let (_approval, _main) = approval::Approval::for_client(pid)?;
            service::elevate(&format!("--install {pid}"))
        }
        Some("--elevate-uninstall") => {
            // Original-user vault cleanup must happen before UAC. The elevated
            // `--uninstall` process enumerates the approving administrator.
            let _ = legacy_cleanup::remove_saved_credentials();
            service::elevate("--uninstall")
        }
        Some("--status") => {
            println!(
                "{}",
                if service::installed_pid().is_ok() {
                    if installation::Installation::current()?
                        .payload_is_current(&std::env::current_exe()?)?
                    {
                        "ready"
                    } else {
                        "updateRequired"
                    }
                } else {
                    "missing"
                }
            );
            Ok(())
        }
        _ => denied(),
    }
}
fn main() {
    if run().is_err() {
        println!("error");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn elevation_isolates_the_helper_search_path_before_uac() {
        let source = include_str!("main.rs");
        assert!(
            source.find("isolate_search_path()").unwrap()
                < source.find("std::env::args()").unwrap()
        );
        assert!(source.contains("SetDllDirectoryW"));
        assert!(source.contains("LOAD_LIBRARY_SEARCH_SYSTEM32"));
        assert!(!source.contains("LOAD_LIBRARY_SEARCH_USER_DIRS"));
        assert!(include_str!("../build.rs").contains("/DEPENDENTLOADFLAG:0x800"));
        assert!(
            source.find("isolate_search_path()").unwrap()
                < source.find("service::elevate").unwrap()
        );
    }
}
