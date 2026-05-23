# Macro Recorder - Architecture.md

## 0. Purpose

Build a **lightweight, cross-device, low-detection-risk macro recorder** with scripting support.

This is NOT a toy project.
This is a **production-grade utility tool** optimized for:

* Low RAM usage
* High performance
* Deterministic + humanized replay
* Extensibility (script engine)

---

## 1. Core Principles

1. **Performance First**

   * No unnecessary abstractions
   * Avoid heavy frameworks (NO Electron)

2. **Native-Level Control**

   * Input capture must be OS-level
   * Playback must be precise but configurable

3. **Separation of Concerns**

   * UI ≠ Core Engine
   * Script Engine isolated

4. **Deterministic + Humanized Execution**

   * Exact replay mode
   * Randomized safe mode

5. **External Only (No Injection)**

   * NEVER hook into game memory
   * NEVER use kernel drivers

---

## 2. Tech Stack

### Core Engine

* Language: **Rust**
* Reason:

  * Memory safety
  * Zero-cost abstractions
  * Native performance

### UI Layer

* Framework: **Tauri (Rust + TypeScript)**
* Reason:
  * Lightweight (compared to Electron)
  * Native performance
  * Low RAM usage

* UI DESIGN
   * dark utility software aesthetic
   * compact control panels
   * dense but clean layout
   * rounded segmented toggles
   * subtle borders
   * gamer/productivity tool feeling
   * minimal futuristic look
   * monochrome palette
   * soft industrial aesthetic
   * clean spacing
   * glyph-inspired accents
   * transparent/lightweight feeling
   * modern typography


### Scripting Engine

* Language: **Lua**
* Rust binding: `mlua`

---

## 3. High-Level Architecture

```
[ UI Layer (Tauri + TS) ]
          ↓
[ Core Engine (Rust) ]
    ├── Input Capture
    ├── Event Storage
    ├── Playback Engine
    ├── Script Engine (Lua)
    └── File Manager
          ↓
[ OS Input Layer ]
```

---

## 4. Modules

---

## 4.1 Input Capture Module

### Responsibilities:

* Capture mouse + keyboard events
* Normalize data
* Send to recorder buffer

### Implementation:

#### Windows APIs:

* Primary: **Raw Input API**
* Fallback: Low-level hooks

### Requirements:

* Device agnostic (works on all keyboards/mice)
* Non-blocking
* Minimal CPU usage

### Output Format:

```json
{
  "type": "mouse_move",
  "x": 120,
  "y": 340,
  "delay": 12
}
```

OR

```json
{
  "type": "key_down",
  "key": "A",
  "delay": 5
}
```

### IMPORTANT:

* Use **delta time**, NOT timestamps

---

## 4.2 Event Storage

### DO NOT:

* Store everything in RAM

### DO:

* Stream to file
* Use binary format

### Binary Structure:

```
[event_type][payload][delta_time]
```

### Benefits:

* Low memory usage
* Fast replay
* Scalable

---

## 4.3 Playback Engine

### Modes:

#### 1. Deterministic Mode

* Exact replay
* No variation

#### 2. Humanized Mode (CRITICAL)

* Random delay variation
* Smooth mouse interpolation

### Humanization Example:

```
delay = base_delay ± random(1–10ms)
```

### Mouse Movement:

* Linear interpolation = BAD
* Bezier curve = GOOD

---

## 4.4 Input Emulation

### Strategy: Hybrid

#### Option A: SendInput (default)

* Fast
* Compatible

#### Option B: Advanced Mode

* Lower-level emulation (future upgrade)

### Rules:

* NEVER inject into processes
* NEVER simulate at kernel level

---

## 4.5 Script Engine (Lua)

### Purpose:

* Advanced macro logic
* User extensibility

### Integration:

* Use `mlua`

### Example Script:

```lua
move(100, 200)
click()
wait(50)
key("A")
```

### Required Functions:

* move(x, y)
* click()
* key(keycode)
* wait(ms)
* loop(n)

### Execution:

* Sandbox environment
* No system access

---

## 4.6 File System

### Responsibilities:

* Save macros
* Load macros
* Version control (basic)

### Format:

* `.macro` (binary)
* `.lua` (scripts)

---

## 5. UI Design (IMPORTANT)

### Goals:

* Minimal
* Fast
* No lag

### Screens:

#### 1. Main Panel

* Start / Stop Recording
* Play Macro
* Mode Selector

#### 2. Timeline View

* Visual event sequence
* Editable delays

#### 3. Script Editor

* Simple code editor
* Syntax highlight (basic)

---

### UI Rules:

* No animations > 150ms
* No heavy libraries
* Dark + Light theme

---

## 6. Performance Targets

* RAM usage: < 50MB
* CPU idle: ~0%
* Recording overhead: minimal
* Startup time: < 1 second

---

## 7. Anti-Detection Strategy

### DO:

* Add randomness
* Simulate human input patterns

### DO NOT:

* Use perfect timing
* Repeat identical patterns infinitely

### CRITICAL:

This tool must remain **external automation only**

---

## 8. MVP Features

* Record mouse + keyboard
* Replay macro
* Save/load macros
* Basic UI
* Deterministic playback

---

## 9. PRO Features (Later)

* Script engine (Lua)
* Humanization settings
* Macro sharing system
* Advanced editor
* Profiles

---

## 10. Development Plan

### Phase 1:

* Core engine (capture + replay)

### Phase 2:

* File system

### Phase 3:

* UI integration

### Phase 4:

* Script engine

---

## 11. Non-Goals

* No kernel drivers
* No anti-cheat bypass
* No game injection
* No cloud dependency

---

## 12. Final Notes

This project succeeds if:

* It is FAST
* It is SIMPLE
* It is TRUSTWORTHY

Avoid overengineering.

Focus on:

> Smooth UX + reliable execution

---

END OF FILE
