chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'capture') {
    const sources = ['tab', 'window', 'screen'];
    chrome.desktopCapture.chooseDesktopMedia(sources, sender.tab, (streamId, options) => {
      if (streamId) {
        sendResponse({ streamId });
      } else {
        sendResponse({ error: 'cancelled' });
      }
    });
    return true; // keep sendResponse alive for async
  }
});
