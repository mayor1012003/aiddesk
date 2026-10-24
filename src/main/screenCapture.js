/**
 * Screen Capture — desktopCapturer wrapper for AidDesk.
 * 
 * Captures the host's screen as a MediaStream for WebRTC transmission.
 * Supports quality presets (Auto/High/Medium/Low) that control
 * resolution and frame rate.
 */

const { desktopCapturer, screen } = require('electron');

// Quality presets: { maxWidth, maxHeight, frameRate }
const QUALITY_PRESETS = {
  high:   { maxWidth: 1920, maxHeight: 1080, frameRate: 30 },
  medium: { maxWidth: 1280, maxHeight: 720,  frameRate: 20 },
  low:    { maxWidth: 854,  maxHeight: 480,  frameRate: 10 },
  auto:   { maxWidth: 1920, maxHeight: 1080, frameRate: 30 }, // Start high, adapt
};

/**
 * Get available screen sources (displays and windows).
 * @returns {Promise<Array>} Array of source objects with id, name, thumbnail
 */
async function getScreenSources() {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnailDataUrl: source.thumbnail.toDataURL(),
    isScreen: source.id.startsWith('screen:'),
  }));
}

/**
 * Build getUserMedia constraints for screen capture.
 * These constraints are used in the renderer to get the MediaStream.
 * 
 * @param {string} sourceId - desktopCapturer source ID
 * @param {string} quality - 'high' | 'medium' | 'low' | 'auto'
 * @returns {object} MediaStream constraints
 */
function buildCaptureConstraints(sourceId, quality = 'auto') {
  const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.auto;

  return {
    audio: false, // Screen audio captured separately if needed
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: preset.maxWidth,
        maxHeight: preset.maxHeight,
        maxFrameRate: preset.frameRate,
      },
    },
  };
}

/**
 * Get the primary display's dimensions.
 * Used to map relative mouse coordinates from client.
 */
function getScreenDimensions() {
  const display = screen.getPrimaryDisplay();
  return {
    width: display.size.width,
    height: display.size.height,
    scaleFactor: display.scaleFactor,
  };
}

module.exports = { getScreenSources, buildCaptureConstraints, getScreenDimensions, QUALITY_PRESETS };
