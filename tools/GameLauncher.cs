// 深城纪 TURBO — portable launcher
// Serves the game folder and opens a chromeless Edge/Chrome app window.
// No install required. Compiled to 深城纪TURBO.exe
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Reflection;

class GameLauncher
{
    static string root;
    static int port;

    static string Mime(string ext)
    {
        switch (ext)
        {
            case ".html": return "text/html; charset=utf-8";
            case ".js": return "application/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".png": return "image/png";
            case ".jpg": case ".jpeg": return "image/jpeg";
            case ".webp": return "image/webp";
            case ".svg": return "image/svg+xml";
            case ".glb": return "model/gltf-binary";
            case ".bin": return "application/octet-stream";
            case ".wasm": return "application/wasm";
            case ".ico": return "image/x-icon";
            default: return "application/octet-stream";
        }
    }

    static int FreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        int p = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return p;
    }

    static void Serve()
    {
        var listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
        listener.Start();
        while (true)
        {
            var ctx = listener.GetContext();
            try
            {
                string rel = ctx.Request.Url.LocalPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                if (string.IsNullOrEmpty(rel)) rel = "index.html";
                string file = Path.Combine(root, rel);
                if (File.Exists(file))
                {
                    byte[] bytes = File.ReadAllBytes(file);
                    ctx.Response.ContentType = Mime(Path.GetExtension(file).ToLowerInvariant());
                    ctx.Response.ContentLength64 = bytes.Length;
                    ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                }
                else
                {
                    byte[] msg = Encoding.UTF8.GetBytes("404");
                    ctx.Response.StatusCode = 404;
                    ctx.Response.OutputStream.Write(msg, 0, msg.Length);
                }
            }
            catch { }
            finally
            {
                try { ctx.Response.OutputStream.Close(); } catch { }
            }
        }
    }

    static void OpenGame()
    {
        string url = "http://127.0.0.1:" + port + "/";
        // Prefer app mode (chromeless window) — feels like a real game
        string[] browsers = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                @"Microsoft\Edge\Application\msedge.exe"),
            @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Google\Chrome\Application\chrome.exe",
            @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        };
        foreach (var b in browsers)
        {
            if (File.Exists(b))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = b,
                    Arguments = "--app=" + url + " --window-size=1280,800 --window-position=120,60",
                    UseShellExecute = true,
                });
                return;
            }
        }
        Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
    }

    [STAThread]
    static void Main()
    {
        root = Path.GetDirectoryName(Assembly.GetEntryAssembly().Location) ?? ".";
        port = FreePort();

        // first-run geometry bake (optional helper)
        string idx = Path.Combine(root, "city-opt", "index.json");
        if (!File.Exists(idx))
        {
            Console.WriteLine("首次启动：正在优化原版模型…");
            string node = Environment.GetEnvironmentVariable("MIMO_NODE");
            if (string.IsNullOrEmpty(node))
            {
                try {
                    var psi = new ProcessStartInfo("where.exe", "node") { RedirectStandardOutput = true, UseShellExecute = false };
                    var p = Process.Start(psi);
                    node = p.StandardOutput.ReadToEnd().Trim().Split('\n')[0].Trim();
                    p.WaitForExit();
                } catch { node = "node"; }
            }
            var bake = new ProcessStartInfo
            {
                FileName = node,
                Arguments = "tools\\optimize-city.mjs",
                WorkingDirectory = root,
                UseShellExecute = false,
            };
            try {
                var bp = Process.Start(bake);
                bp.WaitForExit();
            } catch (Exception e) {
                Console.WriteLine("优化失败: " + e.Message);
            }
        }

        var th = new Thread(Serve) { IsBackground = true };
        th.Start();
        Thread.Sleep(300);
        OpenGame();
        Console.WriteLine("深城纪 TURBO 运行中 — 关闭本窗口即退出游戏。");
        // keep alive until window closed
        Console.ReadLine();
    }
}
