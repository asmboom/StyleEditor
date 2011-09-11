/* vim:set ts=2 sw=2 sts=2 et: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Style Editor code.
 *
 * The Initial Developer of the Original Code is Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Cedric Vivier <cedricv@neonux.com> (original author)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

"use strict";

const EXPORTED_SYMBOLS = ["StyleEditorChrome"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

const STYLE_EDITOR_CONTENT = "chrome://StyleEditor/content/";

Cu.import("resource://gre/modules/Services.jsm");
Cu.import(STYLE_EDITOR_CONTENT + "StyleEditor.jsm");
Cu.import(STYLE_EDITOR_CONTENT + "StyleEditorUtil.jsm");
Cu.import(STYLE_EDITOR_CONTENT + "AdaptiveSplitView.jsm");

const STYLE_EDITOR_TEMPLATE = "stylesheet";


/**
 * StyleEditorChrome constructor.
 *
 * The 'chrome' of the Style Editor is all the around the actual editor (textbox).
 * Manages the sheet selector, history, and opened editor(s) for the attached
 * content window.
 *
 * @param DOMElement aRoot
 *        Element that owns the chrome UI.
 * @param DOMWindow aContentWindow
 *        Optional content DOMWindow to attach to this chrome.
 *        Default: the currently active browser tab content window.
 */
function StyleEditorChrome(aRoot, aContentWindow)
{
  assert(aRoot, "Argument 'aRoot' is required to initialize StyleEditorChrome.");

  this._root = aRoot;
  this._document = this._root.ownerDocument;
  this._window = this._document.defaultView;

  this._editors = [];
  this._listeners = []; // @see addChromeListener

  this._contentWindow = null;
  this._isContentAttached = false;

  let initializeUI = function (aEvent) {
    if (aEvent) {
      this._window.removeEventListener("load", initializeUI, false);
    }

    let viewRoot = this._root.parentNode.querySelector(".splitview-root");
    this._view = new AdaptiveSplitView(viewRoot);

    this._setupChrome();

    // attach to the content window
    this.contentWindow = aContentWindow || getCurrentBrowserTabContentWindow();
  }.bind(this);

  if (this._document.readyState == "complete") {
    initializeUI();
  } else {
    this._window.addEventListener("load", initializeUI, false);
  }
}

StyleEditorChrome.prototype = {
  /**
   * Retrieve the content window attached to this chrome.
   *
   * @return DOMWindow
   */
  get contentWindow() this._contentWindow,

  /**
   * Set the content window attached to this chrome.
   * Content attach or detach events/notifications are triggered after the
   * operation is complete (possibly asynchronous if the content is not fully
   * loaded yet).
   *
   * @param DOMWindow aContentWindow
   * @see addChromeListener
   */
  set contentWindow(aContentWindow)
  {
    if (this._contentWindow == aContentWindow) {
      return; // no change
    }

    this._contentWindow = aContentWindow;

    if (!aContentWindow) {
      this._disableChrome();
      return;
    }

    let onContentUnload = function () {
      aContentWindow.removeEventListener("unload", onContentUnload, false);
      this.contentWindow = null; // detach
    }.bind(this);
    aContentWindow.addEventListener("unload", onContentUnload, false);

    if (aContentWindow.document.readyState == "complete") {
      this._populateChrome();
      return;
    } else {
      let onContentReady = function () {
        aContentWindow.removeEventListener("load", onContentReady, false);
        this._populateChrome();
      }.bind(this);
      aContentWindow.addEventListener("load", onContentReady, false);
    }
  },

  /**
   * Retrieve the content document attached to this chrome.
   *
   * @return DOMDocument
   */
  get contentDocument()
  {
    return this._contentWindow ? this._contentWindow.document : null;
  },

  /**
    * Retrieve whether the content has been attached and StyleEditor instances
    * exist for all of its stylesheets.
    *
    * @return boolean
    * @see addChromeListener
    */
  get isContentAttached() this._isContentAttached,

  /**
   * Retrieve an array with the StyleEditor instance for each live style sheet,
   * ordered by style sheet index.
   *
   * @return Array<StyleEditor>
   */
  get editors()
  {
    let editors = [];
    this._editors.forEach(function (aEditor) {
      if (aEditor.styleSheetIndex >= 0) {
        editors[aEditor.styleSheetIndex] = aEditor;
      }
    });
    return editors;
  },

  /**
   * Add a listener for StyleEditorChrome events.
   *
   * The listener implements IStyleEditorChromeListener := {
   *   onContentAttach:        Called when a content window has been attached.
   *                           All editors are instantiated, though they might
   *                           not be loaded yet.
   *                           Arguments: (StyleEditorChrome aChrome)
   *                           @see contentWindow
   *                           @see StyleEditor.isLoaded
   *                           @see StyleEditor.addActionListener
   *
   *   onContentDetach:        Called when the content window has been detached.
   *                           Arguments: (StyleEditorChrome aChrome)
   *                           @see contentWindow
   *
   *   onEditorAdded:          Called when a stylesheet (therefore a StyleEditor
   *                           instance) has been added to the UI.
   *                           Arguments (StyleEditorChrome aChrome,
   *                                      StyleEditor aEditor)
   * }
   *
   * All listener methods are optional.
   *
   * @param IStyleEditorChromeListener aListener
   * @see removeChromeListener
   */
  addChromeListener: function SEC_addChromeListener(aListener)
  {
    this._listeners.push(aListener);
  },

  /**
   * Remove a listener for Chrome events from the current list of listeners.
   *
   * @param IStyleEditorChromeListener aListener
   * @see addChromeListener
   */
  removeChromeListener: function SEC_removeChromeListener(aListener)
  {
    let index = this._listeners.indexOf(aListener);
    if (index != -1) {
      this._listeners.splice(index, 1);
    }
  },

  /**
   * Trigger named handlers in StyleEditorChrome listeners.
   *
   * @param string aName
   *        Name of the event to trigger.
   * @param Array aArgs
   *        Optional array of arguments to pass to the listener(s).
   * @see addActionListener
   */
  _triggerChromeListeners: function SE__triggerChromeListeners(aName, aArgs)
  {
    // insert the origin Chrome instance as first argument
    if (!aArgs) {
      aArgs = [this];
    } else {
      aArgs.unshift(this);
    }

    // trigger all listeners that have this named handler
    for (let i = 0; i < this._listeners.length; ++i) {
      let listener = this._listeners[i];
      let handler = listener["on" + aName];
      if (handler) {
        handler.apply(listener, aArgs);
      }
    }
  },

  /**
   * Set up the chrome UI. Install event listeners and so on.
   */
  _setupChrome: function SEC__setupChrome()
  {
    // wire up UI elements
    wire(this._view.rootElement, ".style-editor-newButton", function onNewButton() {
      let editor = new StyleEditor(this.contentDocument);
      this._editors.push(editor);
      editor.addActionListener(this);
      editor.load();
    }.bind(this));

    wire(this._view.rootElement, ".style-editor-importButton", function onImportButton() {
      let editor = new StyleEditor(this.contentDocument);
      this._editors.push(editor);
      editor.addActionListener(this);
      editor.importFromFile(this._mockImportFile || null, this._window);
    }.bind(this));
  },

  /**
   * Reset the chrome UI to an empty state.
   */
  _resetChrome: function SEC__resetChrome()
  {
    this._editors.forEach(function (aEditor) {
      aEditor.removeActionListener(this);
    }.bind(this));
    this._editors = [];

    this._view.removeAll();
  },

  /**
   * Populate the chrome UI according to the content document.
   *
   * @see StyleEditor._setupShadowStyleSheet
   */
  _populateChrome: function SEC__populateChrome()
  {
    this._resetChrome();

    this._document.title = _("chromeWindowTitle",
          this.contentDocument.title || this.contentDocument.location.href);

    // queue ContentAttach before all editors are queued for loading
    // do not trigger in this execution context to make sure DOM is sync
    this._window.setTimeout(function () {
      this._triggerChromeListeners("ContentAttach");
    }.bind(this), 0);

    let document = this.contentDocument;
    for (let i = 0; i < document.styleSheets.length; ++i) {
      let styleSheet = document.styleSheets[i];

      let editor = new StyleEditor(document, styleSheet);
      editor.addActionListener(this);
      this._editors.push(editor);

      // Queue editors loading so that ContentAttach is consistently triggered
      // right after all editor instances are available (this.editors) but are
      // NOT loaded/ready yet. This also helps responsivity during loading when
      // there are many heavy stylesheets.
      this._window.setTimeout(function queuedStyleSheetLoad() {
        editor.load();
      }, 0);
    }
  },

  /**
   * Disable all UI, effectively making editors read-only.
   * This is automatically called when no content window is attached.
   *
   * @see contentWindow
   */
  _disableChrome: function SEC__disableChrome()
  {
    let matches = this._root.querySelectorAll("button,input,select");
    for (let i = 0; i < matches.length; ++i) {
      matches[i].setAttribute("disabled", "disabled");
    }

    this.editors.forEach(function onEnterReadOnlyMode(aEditor) {
      aEditor.readOnly = true;
    });

    this._view.rootElement.setAttribute("disabled", "disabled");

    this._triggerChromeListeners("ContentDetach");
  },

  /**
   * Retrieve the summary element for a given editor.
   *
   * @param StyleEditor aEditor
   * @return DOMElement
   *         Item's summary element or null if not found.
   * @see AdaptiveSplitView
   */
  getSummaryElementForEditor: function SEC_getSummaryElementForEditor(aEditor)
  {
    return this._view.getSummaryElementByOrdinal(aEditor.styleSheetIndex);
  },

  /**
   * Update split view summary of given StyleEditor instance.
   *
   * @param StyleEditor aEditor
   * @param DOMElement aSummary
   *        Optional item's summary element to update. If none, item corresponding
   *        to passed aEditor is used.
   */
  _updateSummaryForEditor: function SEC__updateSummaryForEditor(aEditor, aSummary)
  {
    let summary = aSummary || this.getSummaryElementForEditor(aEditor);

    this._view.setItemClassName(summary, aEditor.flags);

    text(summary, ".stylesheet-name", aEditor.getFriendlyName());
    text(summary, ".stylesheet-title", aEditor.styleSheet.title || "");
    text(summary, ".stylesheet-rule-count",
         _("ruleCount.label", aEditor.styleSheet.cssRules.length));

    text(summary, ".stylesheet-error-message", aEditor.errorMessage);
  },

  /**
   * IStyleEditorActionListener implementation
   * @See StyleEditor.addActionListener.
   */

  /**
   * Called when source has been loaded and editor is ready for some action.
   *
   * @param StyleEditor aEditor
   */
  onLoad: function SEAL_onLoad(aEditor)
  {
    let item = this._view.appendTemplatedItem(STYLE_EDITOR_TEMPLATE, {
      data: {
        editor: aEditor
      },
      ordinal: aEditor.styleSheetIndex,
      onCreate: function ASV_onItemCreate(aSummary, aDetails, aData) {
        let editor = aData.editor;

        wire(aSummary, ".stylesheet-enabled", function onToggleEnabled(aEvent) {
          aEvent.stopPropagation();
          aEvent.target.blur();

          editor.enableStyleSheet(editor.styleSheet.disabled);
        });

        wire(aSummary, ".stylesheet-saveButton", function onSaveButton(aEvent) {
          aEvent.stopPropagation();
          aEvent.target.blur();

          editor.saveToFile(editor.savedFile);
        });

        this._updateSummaryForEditor(editor, aSummary);

        // autofocus first or new stylesheet
        if (editor.styleSheetIndex == 0 ||
            editor.hasFlag(StyleEditorFlags.NEW)) {
          this._view.activeSummary = aSummary;
        }

        aSummary.addEventListener("focus", function onSummaryFocus(aEvent) {
          if (aEvent.target == aSummary) {
            // autofocus the stylesheet name
            aSummary.querySelector(".stylesheet-name").focus();
          }
        }, false);

        this._triggerChromeListeners("EditorAdded", [editor]);
      }.bind(this),
      onHide: function ASV_onItemShow(aSummary, aDetails, aData, aIsOrientationChange) {
        let editor = aData.editor;
        if (aIsOrientationChange) {
          // force detach (see bug 254144)
          editor.inputElement = null;
        }
      },
      onShow: function ASV_onItemShow(aSummary, aDetails, aData, aIsOrientationChange) {
        let editor = aData.editor;
        if (!editor.inputElement) {
          // attach input element first time it is shown
          editor.inputElement = aDetails.querySelector(".stylesheet-editor-input");
        }
        editor.inputElement.focus();
      }
    });
  },

  /**
   * Called when an editor flag changed.
   *
   * @param StyleEditor aEditor
   * @param string aFlagName
   * @see StyleEditor.flags
   */
  onFlagChange: function SEAL_onFlagChange(aEditor, aFlagName)
  {
    this._updateSummaryForEditor(aEditor);
  },

  /**
   * Called when  when changes have been committed/applied to the live DOM
   * stylesheet.
   *
   * @param StyleEditor aEditor
   */
  onCommit: function SEAL_onCommit(aEditor)
  {
    this._updateSummaryForEditor(aEditor);
  },
};
