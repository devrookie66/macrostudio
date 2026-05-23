<p align="center">
  <img src="assets/logo.PNG" alt="Macro Studio Logo" width="140" />
</p>

# 🎛️ Macro Studio

[![Rust](https://img.shields.io/badge/Language-Rust-orange?logo=rust&style=flat-square)](#)
[![Tauri](https://img.shields.io/badge/Framework-Tauri_v2-blue?logo=tauri&style=flat-square)](#)
[![TypeScript](https://img.shields.io/badge/Frontend-TypeScript-blue?logo=typescript&style=flat-square)](#)
[![Open Source](https://img.shields.io/badge/Model-Open--Core-green?style=flat-square)](#)
[![License](https://img.shields.io/badge/License-MIT-lightgray?style=flat-square)](#)

A **lightweight, ultra-low-latency, and anti-cheat safe macro recorder** designed for gamers, developers, and power-users. Built from the ground up using **Rust** and **Tauri v2** to ensure zero-cost abstractions, minimal resource overhead, and maximum execution precision.

> **Why Open-Core?** Macro tools and input grabbers are naturally flagged by security software due to the nature of global keyboard hooks. By keeping our global hook, input swallowing, and emulation engine **100% open-source**, we prove to the community and security investigators that **Macro Studio is 100% transparent, malware-free, and contains zero remote telemetries/keyloggers**.

---

## ⚡ Current Features

* **🚀 Ultra-Low Resource Overhead:** Compiles directly to native assembly. Idle RAM usage is **< 30MB**, with **~0% CPU utilization** in the background.
* **🔒 Anti-Cheat & Ban Safe (External-Only):** Strictly interacts via standard, native OS-level simulation APIs. Macro Studio **NEVER** hooks into other process memories, reads memory addresses, or injects kernel-level drivers.
* **🎚️ Dense Visual Timeline:** A beautifully crafted, monochrome utility dashboard featuring:
  * Dynamic keyframe timeline ruler & playhead synchronization.
  * Drag-and-drop keyframe reordering.
  * Context-sensitive inline delay (`ms`) editors.
  * Key grouping and collapsible text sequences.
* **🎯 Precision Playback Control:**
  * **Loop & Toggle Modes:** Continuous execution with easy toggle controls.
  * **Hold-to-Play:** Execute actions only while holding a mapped combination.
  * **Key Swallowing:** Optionally swallow/block the physical keys you use to trigger macros, keeping the target application pristine.
* **🛑 Integrated Emergency Disarm:** Built-in hardware fallback listener (default: hold `Escape` for 5s) to instantly disarm background execution threads and release stuck inputs safely.

---

## 🔔 Coming Soon

### 🌙 Sandboxed Lua Scripting (Active Development)
Run highly complex automation algorithms, conditional loops, and trigger sequences using a fully sandboxed, highly-optimized **Lua 5.4 engine** mapped through native Rust bindings (`mlua`).
* Reactive scripts responding to live hardware triggers (`OnEvent(event, arg)`).
* Direct scripting APIs: `MoveMouseRelative(x, y)`, `PressKey(k)`, `ReleaseKey(k)`, `Sleep(ms)`, and more.
* Automatic execution timeout protection and stuck key cleanups.

### 🆓 Free Download Release
> [!IMPORTANT]
> Macro Studio will be available to download for free **very soon**! Stay tuned for the initial release builds.

---

## 📦 Local Installation & Development

To clone, build, and run the Free Open-Core version locally, make sure you have the standard [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/) installed (Rust, Node.js, and C++ build tools).

### 1. Clone the repository
```bash
git clone https://github.com/devrookie66/macrostudio.git
cd macrostudio
```

### 2. Install dependencies
```bash
npm install
```

### 3. Run in Development Mode
```bash
npm run tauri dev
```

### 4. Build Production Bundle
```bash
npm run tauri build
```

---

## ✉️ Contact & Support

For business inquiries, feedback, or custom integration requests, please reach out to us at:
📧 **studioreas@mail.com**

---

## 📄 License

The Open-Core edition of Macro Studio is licensed under the [MIT License](LICENSE).
