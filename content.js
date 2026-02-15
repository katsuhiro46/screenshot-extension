(() => {
  'use strict';

  const BUTTON_CLASS = 'screenshot-ext-btn';
  const BUTTON_ID = 'screenshot-ext-btn';
  const PASTE_LOCK_MS = 1000;

  // --- Execution lock ---
  let pasteLocked = false;

  function acquirePasteLock() {
    if (pasteLocked) return false;
    pasteLocked = true;
    setTimeout(() => { pasteLocked = false; }, PASTE_LOCK_MS);
    return true;
  }

  function createButton() {
    const btn = document.createElement('button');
    btn.className = BUTTON_CLASS;
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.title = 'Take screenshot';
    btn.textContent = '\u{1F4F7}';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startCapture();
    });
    return btn;
  }

  // --- Site detection ---
  function isChatGPT() {
    return location.hostname === 'chat.openai.com' || location.hostname === 'chatgpt.com';
  }

  function isGemini() {
    return location.hostname === 'gemini.google.com';
  }

  // --- Button injection ---
  function injectButton() {
    // Strict duplicate check: if a button already exists anywhere in DOM, skip
    if (document.querySelector(`#${BUTTON_ID}`)) return;

    if (isChatGPT()) {
      injectChatGPTButton();
    } else if (isGemini()) {
      injectGeminiButton();
    }
  }

  function injectChatGPTButton() {
    const selectors = [
      'div[class*="composer"] div[class*="items-center"]:last-of-type',
      '#prompt-textarea ~ div',
      'form div[class*="flex"][class*="items-center"]',
      'div[class*="composer-parent"] div[class*="flex"][class*="gap"]',
    ];

    for (const sel of selectors) {
      const toolbar = document.querySelector(sel);
      if (toolbar && toolbar.querySelector('button')) {
        toolbar.prepend(createButton());
        return;
      }
    }

    const textarea = document.querySelector('#prompt-textarea');
    if (textarea) {
      const container = textarea.closest('form') || textarea.parentElement;
      if (container) {
        const btn = createButton();
        btn.style.position = 'absolute';
        btn.style.bottom = '12px';
        btn.style.right = '60px';
        btn.style.zIndex = '10';
        container.style.position = 'relative';
        container.appendChild(btn);
      }
    }
  }

  function injectGeminiButton() {
    const selectors = [
      '.input-area-container .action-bar',
      'div[class*="input"] div[class*="action"]',
      'div[class*="input-area"] div[class*="trailing"]',
      '.ql-editor ~ div',
      'rich-textarea ~ div',
    ];

    for (const sel of selectors) {
      const bar = document.querySelector(sel);
      if (bar) {
        bar.prepend(createButton());
        return;
      }
    }

    const inputArea = document.querySelector('rich-textarea, .ql-editor, div[contenteditable="true"]');
    if (inputArea) {
      const container = inputArea.closest('form') || inputArea.parentElement?.parentElement;
      if (container) {
        const btn = createButton();
        btn.style.position = 'absolute';
        btn.style.bottom = '12px';
        btn.style.right = '60px';
        btn.style.zIndex = '10';
        container.style.position = 'relative';
        container.appendChild(btn);
      }
    }
  }

  // --- Capture flow ---
  function startCapture() {
    // Reject if paste lock is active
    if (pasteLocked) return;

    chrome.runtime.sendMessage({ type: 'capture' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Screenshot extension error:', chrome.runtime.lastError.message);
        return;
      }
      if (response?.error) {
        return;
      }
      if (response?.streamId) {
        captureStream(response.streamId);
      }
    });
  }

  async function captureStream(streamId) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: streamId,
          },
        },
      });
    } catch (err) {
      console.error('Screenshot extension: getUserMedia failed', err);
      return;
    }

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;

    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });

    await new Promise((r) => requestAnimationFrame(r));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    stream.getTracks().forEach((t) => t.stop());

    canvas.toBlob((blob) => {
      if (!blob) return;
      pasteImage(blob);
    }, 'image/png');
  }

  function pasteImage(blob) {
    // Acquire lock — if already locked, drop this paste
    if (!acquirePasteLock()) return;

    const now = new Date();
    const ts = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
      + '_'
      + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0')
      + String(now.getSeconds()).padStart(2, '0');
    const file = new File([blob], `screenshot_${ts}.png`, { type: 'image/png' });

    const target = getInputElement();
    if (!target) {
      console.warn('Screenshot extension: no input element found to paste into');
      return;
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });

    target.dispatchEvent(pasteEvent);

    // ChatGPT: intercept any duplicate native handling during the lock window
    if (isChatGPT()) {
      const blocker = (e) => {
        // Block paste/drop events NOT dispatched by this extension
        if (e.isTrusted || e !== pasteEvent) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      };
      target.addEventListener('paste', blocker, { capture: true });
      target.addEventListener('drop', blocker, { capture: true });
      setTimeout(() => {
        target.removeEventListener('paste', blocker, { capture: true });
        target.removeEventListener('drop', blocker, { capture: true });
      }, PASTE_LOCK_MS);
    }
  }

  function getInputElement() {
    if (isChatGPT()) {
      return (
        document.querySelector('#prompt-textarea') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector('textarea')
      );
    }
    if (isGemini()) {
      return (
        document.querySelector('rich-textarea .ql-editor') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector('.text-input-field')
      );
    }
    return document.querySelector('textarea, div[contenteditable="true"]');
  }

  // --- Observe DOM for SPA navigation ---
  let debounceTimer = null;

  function startObserving() {
    injectButton();

    const observer = new MutationObserver(() => {
      // Debounce MutationObserver to avoid rapid repeated injection attempts
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        injectButton();
      }, 300);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving);
  } else {
    startObserving();
  }
})();
