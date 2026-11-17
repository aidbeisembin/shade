// ============================================================================
// FFmpeg Binary Bundling
// ============================================================================
// Download and bundle FFmpeg binaries at build-time to eliminate runtime download delays

/// Откуда сборка берёт ffmpeg. Адреса закреплены на конкретной сборке, суммы SHA-256 зашиты:
/// архив с другой суммой не распаковывается, бинарник с другой суммой не принимается.
/// Выбор источника и причина: docs/case/decisions.md, «ffmpeg из официальных сборок».
///
/// macOS и Linux: статические сборки Мартина Ридля (ffmpeg.martin-riedl.de, ссылка с ffmpeg.org),
/// постоянные адреса по версии, суммы опубликованы рядом с архивом (ffmpeg.zip.sha256).
/// Windows: сборка Gyan (gyan.dev, ссылка с ffmpeg.org) из её GitHub-релиза GyanD/codexffmpeg.
struct FfmpegSource {
    url: &'static str,
    archive_sha256: &'static str,
    binary_sha256: &'static str,
}

const FFMPEG_VERSION: &str = "8.0.1";

fn ffmpeg_source_for_target(target: &str) -> Result<FfmpegSource, String> {
    let source = if target.contains("windows") {
        FfmpegSource {
            url: "https://github.com/GyanD/codexffmpeg/releases/download/8.0.1/ffmpeg-8.0.1-essentials_build.zip",
            archive_sha256: "e2aaeaa0fdbc397d4794828086424d4aaa2102cef1fb6874f6ffd29c0b88b673",
            binary_sha256: "5af82a0d4fe2b9eae211b967332ea97edfc51c6b328ca35b827e73eac560dc0d",
        }
    } else if target.contains("apple") {
        if target.contains("aarch64") {
            FfmpegSource {
                url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1766430132_8.0.1/ffmpeg.zip",
                archive_sha256: "c56f4e2b2ce26a61becf890d8da3415347a1d7d4418cb514915f21612358b790",
                binary_sha256: "3b586ff896c0339e8fd574c143aaccac23c80789341e22d4202f8013a133d3a4",
            }
        } else {
            FfmpegSource {
                url: "https://ffmpeg.martin-riedl.de/download/macos/amd64/1766437297_8.0.1/ffmpeg.zip",
                archive_sha256: "a6c41c69e829697e408308f1ecd6acdfd0d0a84973ff3a6bf782beba83885ed6",
                binary_sha256: "0d9a45766a11804a598731e95b9bf1bc4306850150073e394bb63be8bed50add",
            }
        }
    } else if target.contains("linux") {
        if target.contains("aarch64") || target.contains("arm") {
            FfmpegSource {
                url: "https://ffmpeg.martin-riedl.de/download/linux/arm64/1766429332_8.0.1/ffmpeg.zip",
                archive_sha256: "a032a323119086c2dd71f5e9e27f0cb55c010a3dcc0dd7d5591d06b0a2d87702",
                binary_sha256: "8342efa7d256df6d46e10b4994e234d78498c9254a785b2c6d804b4b609b4e0b",
            }
        } else {
            FfmpegSource {
                url: "https://ffmpeg.martin-riedl.de/download/linux/amd64/1766430728_8.0.1/ffmpeg.zip",
                archive_sha256: "90cdb6066c3b11489df4b8bae1999d2e056e66e728fc482834db92769bf5d202",
                binary_sha256: "aa4a1c02351ff62d3cb80173f7796b93cd540922af1577e075674fc222c4fc1f",
            }
        }
    } else {
        return Err(format!("Unsupported target platform: {}", target));
    };
    Ok(source)
}

fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open {} for checksum: {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read {} for checksum: {}", path.display(), e))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

fn check_sha256(path: &std::path::Path, expected: &str, what: &str) -> Result<(), String> {
    let actual = sha256_file(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!(
            "{} SHA-256 mismatch: expected {}, got {}",
            what, expected, actual
        ))
    }
}

/// Download and bundle FFmpeg binary for current target platform.
/// A cached binary is reused only if its SHA-256 matches the pinned build.
pub fn ensure_ffmpeg_binary() {
    let target = std::env::var("TARGET")
        .or_else(|_| std::env::var("HOST"))
        .expect("Neither TARGET nor HOST environment variable set");

    println!("cargo:warning=🎬 Checking FFmpeg {} binary for target: {}", FFMPEG_VERSION, target);

    let source = ffmpeg_source_for_target(&target)
        .unwrap_or_else(|e| panic!("⚠️  {}", e));

    let binary_name = if target.contains("windows") {
        format!("ffmpeg-{}.exe", target)
    } else {
        format!("ffmpeg-{}", target)
    };

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
        .expect("CARGO_MANIFEST_DIR environment variable not set");
    let binaries_dir = std::path::PathBuf::from(&manifest_dir).join("binaries");
    let binary_path = binaries_dir.join(&binary_name);

    // Cache check: reuse only the pinned build (checksum), and only if it runs
    if binary_path.exists() {
        println!("cargo:warning=🔍 Found cached FFmpeg binary: {}", binary_name);
        match check_sha256(&binary_path, source.binary_sha256, "Cached FFmpeg binary") {
            Ok(()) if verify_ffmpeg_binary(&binary_path) => {
                println!("cargo:warning=✅ FFmpeg binary already cached and verified: {}", binary_name);
                return;
            }
            Ok(()) => {
                println!("cargo:warning=⚠️  Cached FFmpeg binary does not run, re-downloading...");
            }
            Err(e) => {
                println!("cargo:warning=⚠️  {} (not the pinned build), re-downloading...", e);
            }
        }
        let _ = std::fs::remove_file(&binary_path);
    }

    println!("cargo:warning=📥 FFmpeg binary not found, downloading for {}", target);

    // Create binaries directory if it doesn't exist
    if !binaries_dir.exists() {
        std::fs::create_dir_all(&binaries_dir)
            .expect("Failed to create binaries directory");
    }

    // Download and extract
    match download_and_extract_ffmpeg(&target, &source, &binary_path) {
        Ok(()) => {
            println!("cargo:warning=✅ FFmpeg binary downloaded successfully: {}", binary_name);

            // Verify downloaded binary works
            if !verify_ffmpeg_binary(&binary_path) {
                panic!("⚠️  Downloaded FFmpeg binary verification failed!");
            }
        }
        Err(e) => {
            panic!("⚠️  Failed to download FFmpeg: {}", e);
        }
    }
}

/// Download the pinned archive, check its SHA-256, extract, check the binary SHA-256
fn download_and_extract_ffmpeg(
    target: &str,
    source: &FfmpegSource,
    output_path: &std::path::PathBuf,
) -> Result<(), String> {
    use std::io::Write;

    let url = source.url;
    println!("cargo:warning=⬇️  Downloading from: {}", url);

    // Download with timeout (using reqwest from build-dependencies)
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600)) // 10 min timeout for large downloads
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("Failed to download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    println!("cargo:warning=📦 Download size: {:.1} MB", total_size as f64 / 1_048_576.0);

    // Download to temp file
    let temp_dir = std::env::temp_dir();
    let archive_filename = url.split('/').last().unwrap_or("ffmpeg-archive");
    let archive_path = temp_dir.join(format!("ffmpeg-build-{}-{}", target, archive_filename));

    {
        let mut file = std::fs::File::create(&archive_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;

        let content = response.bytes()
            .map_err(|e| format!("Failed to read response: {}", e))?;

        file.write_all(&content)
            .map_err(|e| format!("Failed to write archive: {}", e))?;
    }

    println!("cargo:warning=📦 Downloaded to: {:?}", archive_path);

    if let Err(e) = check_sha256(&archive_path, source.archive_sha256, "FFmpeg archive") {
        let _ = std::fs::remove_file(&archive_path);
        return Err(e);
    }
    println!("cargo:warning=🔐 Archive SHA-256 verified");
    println!("cargo:warning=📂 Extracting FFmpeg binary...");

    // Extract binary (platform-specific)
    let extracted = extract_ffmpeg_from_archive(&archive_path, target, output_path);

    // Cleanup archive
    let _ = std::fs::remove_file(&archive_path);
    extracted?;

    if let Err(e) = check_sha256(output_path, source.binary_sha256, "Extracted FFmpeg binary") {
        let _ = std::fs::remove_file(output_path);
        return Err(e);
    }
    println!("cargo:warning=✨ Extraction complete, binary SHA-256 verified");

    Ok(())
}

/// Extract FFmpeg binary from downloaded ZIP archive
fn extract_ffmpeg_from_archive(
    archive_path: &std::path::Path,
    target: &str,
    output_path: &std::path::PathBuf,
) -> Result<(), String> {
    let extract_dir = std::env::temp_dir().join(format!("ffmpeg-extract-{}", target));

    // Clean old extraction directory
    let _ = std::fs::remove_dir_all(&extract_dir);
    std::fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("Failed to create extract dir: {}", e))?;

    // Determine archive format from extension
    let archive_str = archive_path.to_string_lossy();

    if archive_str.ends_with(".zip") {
        extract_zip(archive_path, &extract_dir)?;
    } else {
        return Err(format!("Unsupported archive format: {}", archive_str));
    }

    // Find extracted FFmpeg binary (platform-specific locations)
    let ffmpeg_binary = find_ffmpeg_in_extracted_dir(&extract_dir, target)?;

    println!("cargo:warning=📋 Found FFmpeg at: {:?}", ffmpeg_binary);

    // Copy to target location
    std::fs::copy(&ffmpeg_binary, output_path)
        .map_err(|e| format!("Failed to copy binary to binaries/: {}", e))?;

    // Set executable permissions on Unix systems
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(output_path)
            .map_err(|e| format!("Failed to get metadata: {}", e))?
            .permissions();
        perms.set_mode(0o755); // rwxr-xr-x
        std::fs::set_permissions(output_path, perms)
            .map_err(|e| format!("Failed to set executable permissions: {}", e))?;
        println!("cargo:warning=🔐 Set executable permissions");
    }

    // Cleanup extraction directory
    let _ = std::fs::remove_dir_all(&extract_dir);

    Ok(())
}

/// Extract ZIP archive
fn extract_zip(
    archive_path: &std::path::Path,
    extract_dir: &std::path::Path,
) -> Result<(), String> {
    use std::io::Read;

    let file = std::fs::File::open(archive_path)
        .map_err(|e| format!("Failed to open ZIP: {}", e))?;

    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry {}: {}", i, e))?;

        // Use enclosed_name() to prevent Zip Slip path traversal attacks
        let outpath = match file.enclosed_name() {
            Some(name) => extract_dir.join(name),
            None => {
                // Skip entries with path traversal sequences (e.g., "../")
                println!("cargo:warning=⚠️  Skipping suspicious ZIP entry: {}", file.name());
                continue;
            }
        };

        if file.is_dir() {
            // Directory
            std::fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            // File
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent directory: {}", e))?;
            }

            let mut outfile = std::fs::File::create(&outpath)
                .map_err(|e| format!("Failed to create output file: {}", e))?;

            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }

        // Set Unix permissions if available
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = file.unix_mode() {
                std::fs::set_permissions(&outpath, std::fs::Permissions::from_mode(mode))
                    .ok();
            }
        }
    }

    Ok(())
}

/// Find FFmpeg binary in extracted directory (handles nested structures)
fn find_ffmpeg_in_extracted_dir(
    extract_dir: &std::path::Path,
    target: &str,
) -> Result<std::path::PathBuf, String> {
    let executable_name = if target.contains("windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };

    // Search patterns (in priority order)
    let search_patterns = [
        extract_dir.join(executable_name),                    // Flat: ffmpeg
        extract_dir.join("bin").join(executable_name),        // Nested: bin/ffmpeg
    ];

    // Try direct paths first
    for pattern in &search_patterns {
        if pattern.exists() && pattern.is_file() {
            return Ok(pattern.clone());
        }
    }

    // Recursive search for nested directories (e.g., ffmpeg-6.0-full_build/bin/ffmpeg.exe)
    for entry in std::fs::read_dir(extract_dir)
        .map_err(|e| format!("Failed to read extract dir: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            // Check bin/ subdirectory
            let bin_path = path.join("bin").join(executable_name);
            if bin_path.exists() && bin_path.is_file() {
                return Ok(bin_path);
            }

            // Check root of subdirectory
            let root_path = path.join(executable_name);
            if root_path.exists() && root_path.is_file() {
                return Ok(root_path);
            }
        }
    }

    Err(format!("FFmpeg binary '{}' not found in extracted archive", executable_name))
}

/// Verify FFmpeg binary is functional (runs -version successfully)
fn verify_ffmpeg_binary(path: &std::path::PathBuf) -> bool {
    match std::process::Command::new(path)
        .arg("-version")
        .output()
    {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(version_line) = stdout.lines().next() {
                    println!("cargo:warning=✅ FFmpeg verification passed: {}", version_line);
                }
                true
            } else {
                false
            }
        }
        Err(_) => false,
    }
}
