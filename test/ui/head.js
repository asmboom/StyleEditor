/* vim: set ts=2 et sw=2 tw=80: */
/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

const TEST_BASE = "chrome://mochitests/content/browser/browser/base/content/test/StyleEditor/";
const TEST_BASE_HTTP = "http://example.com/browser/browser/base/content/test/StyleEditor/";
const TEST_BASE_HTTPS = "https://example.com/browser/browser/base/content/test/StyleEditor/";

let gChromeWindow;               //StyleEditorChrome window

function cleanup()
{
  gChromeWindow.close();
  gChromeWindow = null;
  gBrowser.removeCurrentTab();
}

function launchStyleEditorChrome(aCallback)
{
  gChromeWindow = StyleEditor.openChrome();
  if (gChromeWindow.document.readyState != "complete") {
    gChromeWindow.addEventListener("load", function onChromeLoad() {
      gChromeWindow.removeEventListener("load", onChromeLoad, true);
      aCallback(gChromeWindow.styleEditorChrome);
    }, true);
  } else {
    aCallback(gChromeWindow.styleEditorChrome);
  }
}

function addTabAndLaunchStyleEditorChromeWhenLoaded(aCallback)
{
  gBrowser.selectedTab = gBrowser.addTab();
  gBrowser.selectedBrowser.addEventListener("load", function onLoad() {
    gBrowser.selectedBrowser.removeEventListener("load", onLoad, true);
    launchStyleEditorChrome(aCallback);
  }, true);
}

registerCleanupFunction(cleanup);
