/**
 * Input Control — Mouse and keyboard injection for AidDesk.
 * 
 * Uses robotjs to simulate mouse movements, clicks, scrolling,
 * and keyboard input on the host machine. Events arrive from
 * the remote client via WebRTC DataChannel -> IPC.
 * 
 * All coordinates are normalized (0-1) by the client and
 * mapped to absolute screen coordinates here.
 */

const { screen } = require('electron');

let robot;
try {
  robot = require('robotjs');
  // Set robot to process events more quickly
  robot.setMouseDelay(0);
  robot.setKeyboardDelay(0);
} catch (err) {
  console.warn('[InputControl] robotjs not available. Remote input disabled.');
  console.warn('[InputControl] Run: npm run rebuild');
  robot = null;
}

/**
 * Whether input injection is currently enabled.
 * Can be toggled by the host user during a session.
 */
let inputEnabled = true;

/**
 * Enable or disable input injection.
 */
function setInputEnabled(enabled) {
  inputEnabled = enabled;
  console.log(`[InputControl] Input injection ${enabled ? 'enabled' : 'disabled'}`);
}

function isInputEnabled() {
  return inputEnabled;
}

/**
 * Get current screen dimensions for coordinate mapping.
 */
function getScreenSize() {
  const display = screen.getPrimaryDisplay();
  return { width: display.size.width, height: display.size.height };
}

/**
 * Handle an input event from the remote client.
 * 
 * Event types:
 *  - mousemove:  { type, x, y }          (x,y are 0-1 normalized)
 *  - mousedown:  { type, x, y, button }  (button: 'left'|'right'|'middle')
 *  - mouseup:    { type, x, y, button }
 *  - click:      { type, x, y, button }
 *  - dblclick:   { type, x, y, button }
 *  - scroll:     { type, x, y, deltaX, deltaY }
 *  - keydown:    { type, key, modifiers }
 *  - keyup:      { type, key, modifiers }
 *  - keypress:   { type, key, modifiers }
 */
function handleInputEvent(event) {
  if (!robot || !inputEnabled) return;
  if (!event || !event.type) return;

  const { width, height } = getScreenSize();

  try {
    switch (event.type) {
      case 'mousemove': {
        const absX = Math.round((event.x || 0) * width);
        const absY = Math.round((event.y || 0) * height);
        robot.moveMouse(absX, absY);
        break;
      }

      case 'mousedown': {
        const absX = Math.round((event.x || 0) * width);
        const absY = Math.round((event.y || 0) * height);
        robot.moveMouse(absX, absY);
        robot.mouseToggle('down', mapButton(event.button));
        break;
      }

      case 'mouseup': {
        const absX = Math.round((event.x || 0) * width);
        const absY = Math.round((event.y || 0) * height);
        robot.moveMouse(absX, absY);
        robot.mouseToggle('up', mapButton(event.button));
        break;
      }

      case 'click': {
        const absX = Math.round((event.x || 0) * width);
        const absY = Math.round((event.y || 0) * height);
        robot.moveMouse(absX, absY);
        robot.mouseClick(mapButton(event.button));
        break;
      }

      case 'dblclick': {
        const absX = Math.round((event.x || 0) * width);
        const absY = Math.round((event.y || 0) * height);
        robot.moveMouse(absX, absY);
        robot.mouseClick(mapButton(event.button), true);
        break;
      }

      case 'scroll': {
        const dx = Math.round(event.deltaX || 0);
        const dy = Math.round(event.deltaY || 0);
        // robotjs scrollMouse takes (x, y) scroll amounts
        robot.scrollMouse(dx, dy);
        break;
      }

      case 'keydown':
      case 'keypress': {
        const key = mapKey(event.key);
        if (!key) break;
        const mods = mapModifiers(event.modifiers);
        if (mods.length > 0) {
          robot.keyTap(key, mods);
        } else {
          robot.keyTap(key);
        }
        break;
      }

      case 'keyup':
        // robotjs doesn't have keyToggle for arbitrary keys in all versions;
        // keyTap on keydown is sufficient for most use cases.
        break;

      default:
        console.warn('[InputControl] Unknown event type:', event.type);
    }
  } catch (err) {
    console.error('[InputControl] Error handling event:', event.type, err.message);
  }
}

/**
 * Map browser mouse button to robotjs button name.
 */
function mapButton(button) {
  switch (button) {
    case 'right':  case 2: return 'right';
    case 'middle': case 1: return 'middle';
    default: return 'left';
  }
}

/**
 * Map browser key names to robotjs key names.
 * robotjs uses lowercase key names matching most DOM key values.
 */
function mapKey(key) {
  if (!key) return null;

  // Special key mappings
  const keyMap = {
    'Enter':      'enter',
    'Backspace':  'backspace',
    'Tab':        'tab',
    'Escape':     'escape',
    'Delete':     'delete',
    'ArrowUp':    'up',
    'ArrowDown':  'down',
    'ArrowLeft':  'left',
    'ArrowRight': 'right',
    'Home':       'home',
    'End':        'end',
    'PageUp':     'pageup',
    'PageDown':   'pagedown',
    'Insert':     'insert',
    'F1':  'f1',  'F2':  'f2',  'F3':  'f3',  'F4':  'f4',
    'F5':  'f5',  'F6':  'f6',  'F7':  'f7',  'F8':  'f8',
    'F9':  'f9',  'F10': 'f10', 'F11': 'f11', 'F12': 'f12',
    ' ':          'space',
    'Control':    'control',
    'Shift':      'shift',
    'Alt':        'alt',
    'Meta':       'command',
    'CapsLock':   'caps_lock',
    'NumLock':    'num_lock',
    'PrintScreen': 'printscreen',
  };

  if (keyMap[key]) return keyMap[key];

  // Single character keys
  if (key.length === 1) return key.toLowerCase();

  return null;
}

/**
 * Map modifier object to robotjs modifier array.
 * @param {object} modifiers - { ctrl, shift, alt, meta }
 */
function mapModifiers(modifiers) {
  if (!modifiers) return [];
  const mods = [];
  if (modifiers.ctrl)  mods.push('control');
  if (modifiers.shift) mods.push('shift');
  if (modifiers.alt)   mods.push('alt');
  if (modifiers.meta)  mods.push('command');
  return mods;
}

module.exports = { handleInputEvent, setInputEnabled, isInputEnabled };
