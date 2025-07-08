document.addEventListener('DOMContentLoaded', function () {
    console.log('CSR: Initializing Custom Search Replace'); // DEBUG

    const csrWindow = document.getElementById('csr-window');
    const searchInput = document.getElementById('csr-search-input');
    const closeButton = document.getElementById('csr-close-button');
    const toggleReplaceModeButton = document.getElementById('csr-toggle-replace-mode');
    const replaceControls = document.getElementById('csr-replace-controls');
    const modeIndicator = document.getElementById('csr-window-title');

    // Search mode elements
    const resultsCountDisplay = document.getElementById('csr-results-count');
    const regexButton = document.getElementById('csr-regex-button');
    const caseButton = document.getElementById('csr-case-sensitive-button');
    const wholeWordButton = document.getElementById('csr-whole-word-button');
    const prevMatchButton = document.getElementById('csr-prev-match');
    const nextMatchButton = document.getElementById('csr-next-match');

    // Replace mode elements
    const replaceInput = document.getElementById('csr-replace-input');
    const preserveCaseButton = document.getElementById('csr-preserve-case-button');
    const replaceOneButton = document.getElementById('csr-replace-one-button');
    const replaceAllButton = document.getElementById('csr-replace-all-button');

    if (!csrWindow || !searchInput || !closeButton || !toggleReplaceModeButton || !replaceControls || !modeIndicator ||
        !resultsCountDisplay || !regexButton || !caseButton || !wholeWordButton || !prevMatchButton || !nextMatchButton ||
        !replaceInput || !preserveCaseButton || !replaceOneButton || !replaceAllButton ) {
        console.error('CSR Error: One or more essential UI elements for the search/replace window are missing.');
        return;
    }

    let searchState = {
        searchTerm: '',
        matches: [], // Array to store match objects {node, startOffset, endOffset, text, element, isTextareaMatch}
        currentIndex: -1,
        options: {
            regex: false,
            caseSensitive: false,
            wholeWord: false,
            preserveCase: false // Added for replace mode
        },
        highlightedSpans: [] // To keep track of created <mark> elements
    };
    /**
     * Stores the type of editor content currently being worked with.
     * Can be 'dom' (for Rich Text editors like TinyMCE visual, Gutenberg visual)
     * or 'textarea' (for Gutenberg code editor, Classic editor text mode).
     * Updated by performSearch via getEditorContent.
     */
    let currentEditorType = 'dom';
    let isCsrWindowOpen = false;
    let lastActiveElement = null;


    function isGutenbergActive() {
        // Returns Gutenberg's content-editable element (iframe body or writing flow div) if active
        // This element is then used as the root for DOM traversal (TreeWalker).
        const gutenbergIframe = document.querySelector('.block-editor__editor-skeleton iframe[name="editor-canvas"]');
        if (gutenbergIframe && gutenbergIframe.contentDocument) {
            if (gutenbergIframe.contentDocument.hasFocus() ||
                (gutenbergIframe.contentDocument.activeElement && gutenbergIframe.contentDocument.activeElement !== gutenbergIframe.contentDocument.body)) {
                // console.log("CSR: Gutenberg iframe is considered active"); // DEBUG
                return gutenbergIframe.contentDocument.body;
            }
        }

        const writingFlowSelectors = [
            '.block-editor-writing-flow', // Common
            '.editor-styles-wrapper',     // Fallback / Older versions?
            '.interface-interface-skeleton__content' // Broader container that might hold focus if no specific block is focused
        ];
        for (const selector of writingFlowSelectors) {
            const flowElement = document.querySelector(selector);
            if (flowElement && (flowElement.contains(document.activeElement) || document.activeElement.closest('.block-editor__editable'))) {
                // console.log(`CSR: Gutenberg element '${selector}' is considered active`); // DEBUG
                return flowElement; // Return the most specific editable container or its main wrapper
            }
        }
        return null;
    }

    function isTinyMCEActive() {
        // Returns TinyMCE editor body (root for TreeWalker) if active.
        if (typeof tinymce !== 'undefined' && tinymce.activeEditor && !tinymce.activeEditor.isHidden()) {
            const editor = tinymce.activeEditor;
            // Check if the editor itself has focus, or if focus is within its iframe
            if (editor.hasFocus()) {
                // console.log("CSR: TinyMCE (editor.hasFocus) is active"); // DEBUG
                return editor.getBody();
            }
            if (editor.iframeElement && editor.iframeElement.contentDocument) {
                if (editor.iframeElement.contentDocument.hasFocus() ||
                    (editor.iframeElement.contentDocument.activeElement && editor.iframeElement.contentDocument.activeElement !== editor.iframeElement.contentDocument.body )) {
                    // console.log("CSR: TinyMCE iframe is active"); // DEBUG
                    return editor.getBody();
                }
            }
        }
        return null;
    }


    // --- Event Listeners for Search Options ---
    regexButton.addEventListener('click', () => toggleSearchOption('regex', regexButton));
    caseButton.addEventListener('click', () => toggleSearchOption('caseSensitive', caseButton));
    wholeWordButton.addEventListener('click', () => toggleSearchOption('wholeWord', wholeWordButton));

    function toggleSearchOption(optionName, buttonElement) {
        searchState.options[optionName] = !searchState.options[optionName];
        buttonElement.classList.toggle('active', searchState.options[optionName]);
        performSearch();
    }

    // --- Event Listeners for Replace Options & Actions ---
    preserveCaseButton.addEventListener('click', () => toggleReplaceOption('preserveCase', preserveCaseButton));

    replaceOneButton.addEventListener('click', replaceOneMatch);
    replaceAllButton.addEventListener('click', replaceAllMatches);

    function toggleReplaceOption(optionName, buttonElement) {
        searchState.options[optionName] = !searchState.options[optionName];
        buttonElement.classList.toggle('active', searchState.options[optionName]);
        // This option change will be considered at the moment of replacement, no need to re-search.
    }

    function applyPreserveCase(originalText, replacementText) {
        if (!originalText || !replacementText) { // Handle empty strings
            return replacementText;
        }

        // Case 1: Original is all uppercase
        let allUpper = true;
        for (let i = 0; i < originalText.length; i++) {
            if (originalText[i] !== originalText[i].toUpperCase()) {
                allUpper = false;
                break;
            }
        }
        if (allUpper) return replacementText.toUpperCase();

        // Case 2: Original is all lowercase
        let allLower = true;
        for (let i = 0; i < originalText.length; i++) {
            if (originalText[i] !== originalText[i].toLowerCase()) {
                allLower = false;
                break;
            }
        }
        if (allLower) return replacementText.toLowerCase();

        // Case 3: First letter capitalized (simple title or sentence start)
        if (originalText[0] === originalText[0].toUpperCase()) {
            if (originalText.length === 1 || originalText.substring(1) === originalText.substring(1).toLowerCase()) {
                 // If rest is lower (likely sentence or simple title like "Word")
                return replacementText.length > 0 ? replacementText[0].toUpperCase() + replacementText.substring(1).toLowerCase() : "";
            }
            // If first is upper but rest is mixed or also upper (e.g. "UPPer" or "TITLE Case")
            // Try to make first letter of replacement upper.
            return replacementText.length > 0 ? replacementText[0].toUpperCase() + replacementText.substring(1) : "";
        }

        // Default: if original starts with lowercase, make replacement start with lowercase (if not already)
        if (originalText[0] === originalText[0].toLowerCase()) {
             return replacementText.length > 0 ? replacementText[0].toLowerCase() + replacementText.substring(1) : "";
        }

        return replacementText; // Fallback
    }

    /**
     * Replaces the content of a given match's highlight element with new text.
     * @param {object} matchData - The match object from searchState.matches.
     * @param {string} rawReplacementText - The text to replace with.
     * @returns {boolean} - True if replacement was successful, false otherwise.
     */
    function replaceNodeContent(matchData, rawReplacementText) {
        if (!matchData || !matchData.element || !matchData.element.parentNode) {
            // console.warn("CSR: Invalid match data or element for replacement.", matchData);
            return false;
        }

        let finalText = rawReplacementText;
        if (searchState.options.preserveCase) {
            finalText = applyPreserveCase(matchData.text, rawReplacementText);
        }

        const newTextNode = document.createTextNode(finalText);
        const parent = matchData.element.parentNode;

        try {
            parent.replaceChild(newTextNode, matchData.element);
            parent.normalize();

            matchData.node = newTextNode;
            matchData.text = finalText;
            matchData.element = null;     // The <mark> element is gone

            // TODO: Integrate with WordPress editor's Undo/Redo stack.
            // Current DOM manipulation is direct and won't be part of TinyMCE or Gutenberg's history.
            // For TinyMCE: editor.undoManager.transact(() => { /* changes */ });
            // For Gutenberg: Use wp.data.dispatch('core/block-editor').updateBlockAttributes() or similar,
            // which handles undo automatically. This would require a different approach to finding/replacing content.

            return true;
        } catch (e) {
            console.error("CSR: Error replacing node content:", e, matchData);
            return false;
        }
    }

    function replaceOneMatch() {
        if (searchState.currentIndex === -1 || searchState.matches.length === 0) {
            updateResultsDisplay();
            return;
        }

        const matchToReplace = searchState.matches[searchState.currentIndex];
        const replacementText = replaceInput.value;

        if (replaceNodeContent(matchToReplace, replacementText)) {
            searchState.highlightedSpans = searchState.highlightedSpans.filter(span => span !== matchToReplace.element);
            searchState.matches.splice(searchState.currentIndex, 1);

            updateResultsDisplay();

            if (searchState.matches.length === 0) {
                searchState.currentIndex = -1;
                resultsCountDisplay.textContent = 'All matches replaced.';
            } else {
                if (searchState.currentIndex >= searchState.matches.length) {
                    searchState.currentIndex = searchState.matches.length - 1;
                }
                navigateToMatch(searchState.currentIndex);
            }
        } else {
            resultsCountDisplay.textContent = "Error during replacement.";
        }
    }

    function replaceAllMatches() {
        if (searchState.matches.length === 0) {
            updateResultsDisplay();
            return;
        }

        const replacementText = replaceInput.value;
        let replacedCount = 0;

        const matchesToProcess = [...searchState.matches];

        for (let i = matchesToProcess.length - 1; i >= 0; i--) {
            if (replaceNodeContent(matchesToProcess[i], replacementText)) {
                replacedCount++;
            }
        }

        resultsCountDisplay.textContent = `Replaced ${replacedCount} occurrence(s).`;

        clearHighlights();
        searchState.matches = [];
        searchState.currentIndex = -1;
        // searchState.highlightedSpans should be empty from clearHighlights
    }


    /**
     * Replaces the content of a single match.
     * Handles DOM replacement by swapping the <mark> element with a new text node.
     * Handles textarea replacement by directly manipulating the textarea's value.
     * @param {object} matchData - The match object.
     * @param {string} rawReplacementText - The raw text to replace with.
     * @returns {number|boolean} For textarea: the change in text length (newLength - oldLength).
     *                             For DOM: true on success, false on failure.
     *                             Returns false on general failure.
     */
    function replaceNodeContent(matchData, rawReplacementText) {
        if (!matchData || !matchData.node) {
            // console.warn("CSR: Invalid match data or node for replacement.", matchData);
            return false;
        }

        let finalText = rawReplacementText;
        if (searchState.options.preserveCase) {
            finalText = applyPreserveCase(matchData.text, rawReplacementText);
        }

        if (matchData.isTextareaMatch) {
            const textarea = matchData.node;
            const originalValue = textarea.value;
            const originalMatchTextLength = matchData.text.length;

            try {
                textarea.value = originalValue.substring(0, matchData.startOffset) +
                                 finalText +
                                 originalValue.substring(matchData.endOffset);

                matchData.text = finalText;
                matchData.endOffset = matchData.startOffset + finalText.length; // Update for this specific match

                return finalText.length - originalMatchTextLength; // Return length change
            } catch (e) {
                // console.error("CSR: Error replacing content in textarea:", e, matchData);
                textarea.value = originalValue; // Attempt to restore
                return false;
            }
        } else { // DOM replacement
            if (!matchData.element || !matchData.element.parentNode) {
                //  console.warn("CSR: Invalid DOM element for replacement.", matchData);
                 return false;
            }
            const newTextNode = document.createTextNode(finalText);
            const parent = matchData.element.parentNode;
            try {
                parent.replaceChild(newTextNode, matchData.element);
                parent.normalize();
                matchData.node = newTextNode;
                matchData.text = finalText;
                matchData.element = null; // The <mark> element is gone
                // TODO: Integrate with WordPress editor's Undo/Redo stack.
                // Current DOM manipulation is direct and won't be part of TinyMCE or Gutenberg's history.
                // For TinyMCE: editor.undoManager.transact(() => { /* changes */ });
                // For Gutenberg: Use wp.data.dispatch('core/block-editor').updateBlockAttributes() or similar.
                return true;
            } catch (e) {
                // console.error("CSR: Error replacing DOM node content:", e, matchData);
                return false;
            }
        }
    }

    /**
     * Handles the "Replace" button click. Replaces the current match.
     * For DOM, it removes the highlight and updates the match list.
     * For textarea, it adjusts offsets of subsequent matches after replacement.
     */
    function replaceOneMatch() {
        if (searchState.currentIndex === -1 || searchState.matches.length === 0) {
            updateResultsDisplay();
            return;
        }

        const matchToReplace = searchState.matches[searchState.currentIndex];
        const replacementText = replaceInput.value;
        // const originalMatchTextLength = matchToReplace.text.length; // Not directly used here anymore

        const replacementResult = replaceNodeContent(matchToReplace, replacementText); // Returns lengthChange for textarea, true/false for DOM

        if (replacementResult !== false) {
            if (matchToReplace.isTextareaMatch) {
                const lengthChange = replacementResult; // Cast boolean to number for safety, though it's lengthChange for textarea

                searchState.matches.splice(searchState.currentIndex, 1); // Remove the replaced match

                // Adjust offsets for subsequent matches in the *same textarea*
                // This is crucial for subsequent "Replace" clicks to target correctly.
                for (let i = searchState.currentIndex; i < searchState.matches.length; i++) {
                    if (searchState.matches[i].isTextareaMatch && searchState.matches[i].node === matchToReplace.node) {
                        searchState.matches[i].startOffset += lengthChange;
                        searchState.matches[i].endOffset += lengthChange;
                    }
                }

                updateResultsDisplay();

                if (searchState.matches.length === 0) {
                    searchState.currentIndex = -1;
                    resultsCountDisplay.textContent = csr_i18n.all_matches_replaced || 'All matches replaced.';
                } else {
                    // Try to stay at the same index if possible, or move to the new item at that index
                    if (searchState.currentIndex >= searchState.matches.length) {
                        searchState.currentIndex = searchState.matches.length - 1;
                    }
                    navigateToMatch(searchState.currentIndex);
                }
            } else { // DOM match
                searchState.highlightedSpans = searchState.highlightedSpans.filter(span => span !== matchToReplace.element);
                searchState.matches.splice(searchState.currentIndex, 1);

                updateResultsDisplay();

                if (searchState.matches.length === 0) {
                    searchState.currentIndex = -1;
                    resultsCountDisplay.textContent = csr_i18n.all_matches_replaced || 'All matches replaced.';
                } else {
                    if (searchState.currentIndex >= searchState.matches.length) {
                        searchState.currentIndex = searchState.matches.length - 1;
                    }
                    navigateToMatch(searchState.currentIndex);
                }
            }
        } else {
            resultsCountDisplay.textContent = csr_i18n.error_during_replacement || "Error during replacement.";
        }
    }

    function replaceAllMatches() {
        if (searchState.matches.length === 0) {
            updateResultsDisplay();
            return;
        }

        const replacementText = replaceInput.value;
        let replacedCount = 0;

        if (currentEditorType === 'textarea' && searchState.matches.length > 0 && searchState.matches[0].isTextareaMatch) {
            const textarea = searchState.matches[0].node;
            let currentTextValue = textarea.value;
            let accumulatedLengthChange = 0; // Keep track of how much the string length has changed

            // Sort matches by startOffset to process them in order for string manipulation
            // although iterating backwards is generally safer for array mutation, for string replacement
            // processing from start to end with offset adjustments is also an option.
            // However, since we are rebuilding the string from parts based on original offsets,
            // iterating backwards on the original match array is safer to avoid index issues.
            const matchesToProcess = [...searchState.matches].sort((a,b) => a.startOffset - b.startOffset);


            for (let i = matchesToProcess.length - 1; i >= 0; i--) {
                const matchData = matchesToProcess[i];
                 if (!matchData.isTextareaMatch || matchData.node !== textarea) continue;

                let finalTextToInsert = replacementText;
                if (searchState.options.preserveCase) {
                    finalTextToInsert = applyPreserveCase(matchData.text, replacementText);
                }

                // Use original offsets from matchData, as currentTextValue is being rebuilt
                currentTextValue = currentTextValue.substring(0, matchData.startOffset) +
                                   finalTextToInsert +
                                   currentTextValue.substring(matchData.endOffset);
                replacedCount++;
            }
            textarea.value = currentTextValue;
        } else if (currentEditorType === 'dom') {
            const matchesToProcess = [...searchState.matches]; // Process a copy
            for (let i = matchesToProcess.length - 1; i >= 0; i--) { // Iterate backwards for DOM
                if (matchesToProcess[i].isTextareaMatch) continue;
                if (replaceNodeContent(matchesToProcess[i], replacementText)) {
                    replacedCount++;
                }
            }
        }

        resultsCountDisplay.textContent = csr_i18n.replaced_n_occurrences ?
                                          csr_i18n.replaced_n_occurrences.replace('%d', replacedCount) :
                                          `Replaced ${replacedCount} occurrence(s).`;

        clearHighlights();
        searchState.matches = [];
        searchState.currentIndex = -1;
        // highlightedSpans is cleared in clearHighlights if it's DOM mode

        if (currentEditorType === 'textarea' && searchState.matches.length > 0 && searchState.matches[0].node) {
           // searchState.matches[0].node.focus(); // searchState.matches is empty now
        } else if (searchInput) {
            // searchInput.focus(); // Let user decide next action
        }
    }


    // --- Textarea Specific Handlers ---

    /**
     * Placeholder for highlighting all matches in a textarea.
     * Currently, only the *current* match is "highlighted" by text selection via navigateToTextareaMatch.
     * General highlighting of all matches with <mark> is not done for textareas.
     * @param {object} matchData - The match object.
     */
    function highlightMatchInTextarea(matchData) {
        if (!matchData.isTextareaMatch) return;
        // console.log("CSR: highlightMatchInTextarea: No visual <mark> for textarea. Current match selection is handled by navigateToTextareaMatch.");
    }

    /**
     * Placeholder for clearing all highlights in a textarea.
     * Since <mark> tags are not used, this primarily means ensuring any text selection is cleared if needed.
     * @param {HTMLTextAreaElement} textareaElement - The textarea element.
     */
    function clearTextareaHighlights(textareaElement) {
        // console.log("CSR: clearTextareaHighlights: No <mark> elements to clear in textarea.");
        // If a selection was made programmatically for a "current" match, it's typically
        // superseded by the next navigation or by the user clicking elsewhere.
        // Explicitly clearing selection:
        // if (textareaElement && textareaElement === document.activeElement) {
        //     textareaElement.selectionStart = textareaElement.selectionEnd;
        // }
    }

    /**
     * Navigates to a specific match within a textarea by selecting the text
     * and scrolling it into view. Updates searchState.currentIndex.
     * @param {object} matchData - The match object (must be isTextareaMatch: true).
     * @param {number} index - The index of the match in searchState.matches.
     */
    function navigateToTextareaMatch(matchData, index) {
        if (!matchData || !matchData.isTextareaMatch || !matchData.node || typeof matchData.startOffset !== 'number') {
            // console.warn("CSR: Invalid data for navigateToTextareaMatch", matchData);
            return;
        }
        const textarea = matchData.node;
        try {
            textarea.focus();
            textarea.selectionStart = matchData.startOffset;
            textarea.selectionEnd = matchData.endOffset;

            // Scroll into view - native textarea scroll behavior might be sufficient,
            // but this ensures it if content is long.
            const textBeforeSelection = textarea.value.substring(0, matchData.startOffset);
            const lines = textBeforeSelection.split('\n').length;
            // Rough estimate for line height, might not be perfect.
            const computedStyle = window.getComputedStyle(textarea);
            let lineHeight = parseFloat(computedStyle.lineHeight);
            if (isNaN(lineHeight)) lineHeight = parseFloat(computedStyle.fontSize) * 1.2; // Default multiplier

            textarea.scrollTop = Math.max(0, (lines - Math.floor(textarea.clientHeight / lineHeight / 2)) * lineHeight);


            searchState.currentIndex = index; // Crucial: update currentIndex
            updateResultsDisplay();

        } catch (e) {
            console.error("CSR: Error navigating in textarea:", e);
        }
    }


    // --- Search Input Change ---
    function highlightMatchInTextarea(matchData) {
        // For textarea, we don't create <mark> elements.
        // We will "highlight" the current match by selecting it during navigation.
        // So, this function doesn't need to do anything here for general highlighting of all matches.
        // Individual current match selection is handled by navigateToMatch.
        if (!matchData.isTextareaMatch) return; // Should not be called if not textarea
        // console.log("CSR: highlightMatchInTextarea called, but no visual <mark> for textarea.", matchData);
    }

    function clearTextareaHighlights(textareaElement) {
        // No <mark> elements to clear.
        // If we were storing selection ranges, we might clear them here.
        // For now, nothing to do.
        // console.log("CSR: clearTextareaHighlights called.", textareaElement);
    }

    function navigateToTextareaMatch(matchData, index) {
        if (!matchData || !matchData.isTextareaMatch || !matchData.node || typeof matchData.startOffset === 'undefined') {
            console.warn("CSR: Invalid data for navigateToTextareaMatch", matchData);
            return;
        }
        const textarea = matchData.node;
        try {
            textarea.focus();
            textarea.selectionStart = matchData.startOffset;
            textarea.selectionEnd = matchData.endOffset;

            // Scroll into view - native textarea scroll behavior might be sufficient,
            // but this ensures it if content is long.
            const textBeforeSelection = textarea.value.substring(0, matchData.startOffset);
            const lines = textBeforeSelection.split('\n').length;
            const avgLineHeight = textarea.scrollHeight / (textarea.value.split('\n').length || 1);
            textarea.scrollTop = Math.max(0, (lines - 5) * avgLineHeight); // Scroll a bit above the line

            searchState.currentIndex = index;
            updateResultsDisplay();

        } catch (e) {
            console.error("CSR: Error navigating in textarea:", e);
        }
    }


    // --- Search Input Change ---
    searchInput.addEventListener('input', function() {
        // Debounce search slightly to avoid performance issues on very fast typing
        clearTimeout(searchInput.searchTimeout);
        searchInput.searchTimeout = setTimeout(() => {
            searchState.searchTerm = this.value;
            if (searchState.searchTerm.length > 0) {
                performSearch();
            } else {
                clearSearch();
            }
        }, 150); // 150ms debounce
    });

    // Prevent form submission if it's part of a form
    searchInput.closest('form')?.addEventListener('submit', (e) => e.preventDefault());


    // --- Navigation Buttons & Enter Key in Search Input ---
    prevMatchButton.addEventListener('click', navigateToPrevMatch);
    nextMatchButton.addEventListener('click', navigateToNextMatch);

    searchInput.addEventListener('keydown', function(e) {
        if (searchState.matches.length === 0) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
                navigateToPrevMatch();
            } else {
                navigateToNextMatch();
            }
        }
    });

    /**
     * Performs the search based on the current search term and options.
     * Determines the editor type, fetches content, finds matches,
     * and updates the UI with highlights and results.
     */
    function performSearch() {
        if (!searchState.searchTerm) {
            clearSearch();
            return;
        }

        clearHighlights(); // Considers currentEditorType for proper clearing
        searchState.matches = [];
        searchState.currentIndex = -1;
        if (currentEditorType === 'dom') {
            searchState.highlightedSpans = []; // Reset spans only for DOM mode
        }

        const editorData = getEditorContent(); // Fetches content and determines type ('dom' or 'textarea')
        currentEditorType = editorData.type;   // Update global state for editor type

        // Validate editorData based on its type before proceeding
        if (currentEditorType === 'textarea' && typeof editorData.text !== 'string') {
            updateResultsDisplay(true, csr_i18n.no_results || 'No results');
            console.warn("CSR: Textarea mode but no text provided.", editorData);
            return;
        }
        if (currentEditorType === 'dom' && (!editorData.nodes || editorData.nodes.length === 0)) {
            // It's possible to have a DOM editor with no text nodes yet (e.g. empty post)
            // updateResultsDisplay will handle showing "No results" if search term is present.
            // So, only log if sourceElement itself is missing, which would be an error in getEditorContent
            if (!editorData.sourceElement) console.warn("CSR: DOM mode but no sourceElement or text nodes.", editorData);
        }

        const rawMatches = findMatchesInContent(editorContent.nodes, searchState.searchTerm, searchState.options);

        if (currentEditorType === 'dom') {
            rawMatches.forEach(matchData => {
                if (matchData.isTextareaMatch) return; // Should not happen if findMatchesInContent is correct
                const markElement = highlightMatchInNode(matchData.node, matchData.startOffset, matchData.endOffset);
                if (markElement) {
                    matchData.element = markElement;
                    searchState.matches.push(matchData);
                    searchState.highlightedSpans.push(markElement);
                }
            });
            if (searchState.matches.length > 1) {
                searchState.matches.sort((a, b) => {
                    if (!a.element || !b.element) return 0;
                    const pos = a.element.compareDocumentPosition(b.element);
                    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
                    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
                    return 0;
                }).reverse();
            }
        } else { // textarea
            searchState.matches = rawMatches; // rawMatches are already suitable for textarea
        }

        updateResultsDisplay();

        if (searchState.matches.length > 0) {
            navigateToMatch(0);
        } else {
             // Focus appropriate input if no matches
             if (editorData.sourceElement && currentEditorType === 'textarea') editorData.sourceElement.focus();
             else if (searchInput) searchInput.focus();
        }
    }

    /**
     * Clears the current search results and highlights.
     * Keeps the search term in the input field.
     */
    function clearSearch() {
        clearHighlights(); // This function now considers currentEditorType
        searchState.matches = [];
        searchState.currentIndex = -1;
        updateResultsDisplay(); // Update to show "No results" or empty if term is also empty
    }

    /**
     * Clears all visual highlights from the editor.
     * For DOM mode, it removes <mark> tags and .csr-current-match class.
     * For textarea mode, it conceptually does nothing as highlights are transient selections.
     */
    function clearHighlights() {
        if (currentEditorType === 'dom') {
            // Remove 'current match' styling from the currently active DOM match element
            if (searchState.currentIndex !== -1 &&
                searchState.matches.length > searchState.currentIndex &&
                searchState.matches[searchState.currentIndex] &&
                !searchState.matches[searchState.currentIndex].isTextareaMatch &&
                searchState.matches[searchState.currentIndex].element) {
                searchState.matches[searchState.currentIndex].element.classList.remove('csr-current-match');
            }

            // Unwrap all <mark> tags used for highlighting
            searchState.highlightedSpans.forEach(span => {
                if (span && span.parentNode) {
                    const textNode = document.createTextNode(span.textContent);
                    try {
                        span.parentNode.replaceChild(textNode, span);
                        textNode.parentNode.normalize();
                    } catch (e) {
                        // console.warn("CSR: Error un-highlighting node:", e, span);
                    }
                }
            });
            searchState.highlightedSpans = [];
        } else { // textarea
            // For textarea, "clearing highlights" means deselecting text.
            // This is implicitly handled when a new search starts or window closes.
            // Or if a specific textarea element was stored as "currently highlighted"
            // const currentTextareaMatch = searchState.matches[searchState.currentIndex];
            // if (currentTextareaMatch && currentTextareaMatch.isTextareaMatch && currentTextareaMatch.node) {
            //    currentTextareaMatch.node.selectionStart = currentTextareaMatch.node.selectionEnd;
            // }
            // console.log("CSR: Cleared highlights for textarea (conceptually).");
        }
    }

    // highlightMatchInNode remains for DOM, no changes needed here for textarea logic itself

function highlightMatchInNode(textNode, startOffset, endOffset) {
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE || startOffset < 0 || endOffset < 0 || endOffset <= startOffset) {
        // console.warn("CSR: highlightMatchInNode - Invalid input", textNode, startOffset, endOffset); // DEBUG
        return null;
    }

    const originalText = textNode.nodeValue;
    // Ensure offsets are within the bounds of the original text.
    // startOffset can be 0, endOffset can be originalText.length.
    if (startOffset > originalText.length || endOffset > originalText.length || startOffset > endOffset) {
         // console.warn("CSR: highlightMatchInNode - Invalid offsets for highlighting.", { nodeValue: originalText, startOffset, endOffset, originalLength: originalText.length }); // DEBUG
         return null;
    }

    const matchText = originalText.substring(startOffset, endOffset);
    if (!matchText) { // If substring is empty, no need to highlight.
        // console.warn("CSR: highlightMatchInNode - Extracted matchText is empty."); // DEBUG
        return null;
    }

    // console.log(`CSR: highlightMatchInNode - Attempting to highlight "${matchText}" in node:`, textNode.parentNode); // DEBUG
    // console.log(`CSR: --- Node value: "${originalText}" (len: ${originalText.length}), start: ${startOffset}, end: ${endOffset}`); // DEBUG

    try {
        const mark = document.createElement('mark');
        mark.className = 'csr-highlight';
        mark.textContent = matchText;

        let S = textNode; // S is the part before the match
        let M;            // M will be the part that matches
        let E;            // E will be the part after the match

        if (startOffset === 0 && endOffset === S.length) { // Match is the entire text node
            M = S;
            S = null; // No preceding text
            E = null; // No succeeding text
        } else if (startOffset === 0) { // Match starts at the beginning of the node
            M = S.splitText(endOffset); // S becomes the match, M becomes the rest (E)
            E = M;
            M = S;
            S = null;
        } else if (endOffset === S.length) { // Match ends at the end of the node
            M = S.splitText(startOffset); // S is before, M is the match
            E = null;
        } else { // Match is in the middle
            M = S.splitText(startOffset); // S is before, M is match + end
            E = M.splitText(matchText.length); // M is match, E is end
        }

        // console.log(`CSR: --- Split parts: S="${S ? S.nodeValue : 'null'}", M="${M ? M.nodeValue : 'null'}", E="${E ? E.nodeValue : 'null'}"`); // DEBUG

        if (!M || M.nodeValue !== matchText) {
            // console.warn(`CSR: highlightMatchInNode - Mismatch or M is null! Expected M to be "${matchText}", got "${M ? M.nodeValue : 'null'}". This indicates an issue with splitText or logic.`);
            // Attempt to put things back if they were split and S still exists with a parent
            if (S && S.parentNode) S.parentNode.normalize();
            else if (textNode && textNode.parentNode) textNode.parentNode.normalize(); // Fallback to original node
            return null;
        }

        const parent = M.parentNode;
        if (parent) {
            parent.replaceChild(mark, M);
            // console.log("CSR: --- Replaced M with mark. Parent:", parent); // DEBUG
            // No normalize() here to avoid messing with subsequent matches in sibling text nodes from the same original node.
            // Normalization should happen after all operations on a broader scope if needed.
            return mark;
        } else {
            // console.warn("CSR: highlightMatchInNode - Parent node not found for M. Node M:", M); // DEBUG
            // If S still exists and has a parent, try to normalize it to clean up splits
            if (S && S.parentNode) S.parentNode.normalize();
            else if (textNode && textNode.parentNode) textNode.parentNode.normalize();
            return null;
        }
    } catch (e) {
        console.error("CSR: highlightMatchInNode - Error during DOM manipulation:", e, {
            originalNodeValue: originalText,
            matchText: matchText,
            startOffset: startOffset,
            endOffset: endOffset,
            textNodeState: textNode ? textNode.nodeValue : 'null'
        });
        if (textNode && textNode.parentNode) textNode.parentNode.normalize();
        return null;
    }
}

    function getEditorContent() {
        let activeEditorElement = null;
        const textNodes = [];

        const isGutenbergActive = () => {
            if (typeof wp !== 'undefined' && wp.data && wp.data.select('core/editor') && wp.data.select('core/block-editor')) {
                const editorProvider = wp.data.select('core/editor');
                const blockEditorProvider = wp.data.select('core/block-editor');
                if (editorProvider && blockEditorProvider) {
                    const editorInstance = document.querySelector('.block-editor__editor-skeleton iframe[name="editor-canvas"], .block-editor__editor-skeleton .block-editor-writing-flow'); // More specific targets
                    if (editorInstance) {
                         // Check if document.activeElement is within the Gutenberg editing area
                        if (editorInstance.tagName === 'IFRAME') {
                            return editorInstance.contentDocument && editorInstance.contentDocument.hasFocus ? editorInstance.contentDocument.body : null;
                        }
                        return editorInstance.contains(document.activeElement) || document.activeElement.closest('.block-editor__editable') ? editorInstance : null;
                    }
                }
            }
            return null;
        };

        const isTinyMCEActive = () => {
            if (typeof tinymce !== 'undefined' && tinymce.activeEditor && !tinymce.activeEditor.isHidden()) {
                const editorBody = tinymce.activeEditor.getBody();
                if (editorBody === document.activeElement || editorBody.contains(document.activeElement)) {
                    return editorBody;
                }
            }
            return null;
        };

        activeEditorElement = isGutenbergActive() || isTinyMCEActive();

        if (!activeEditorElement) { // Fallback if specific active editor not detected
            activeEditorElement =
                document.querySelector('.block-editor__editor-skeleton iframe[name="editor-canvas"]')?.contentDocument?.body ||
                document.querySelector('.editor-styles-wrapper') ||
                document.getElementById('content_ifr')?.contentDocument?.body ||
                document.getElementById('content');
        }

        if (activeEditorElement) {
            const treeWalker = document.createTreeWalker(
                activeEditorElement,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function (node) {
                        if (node.parentElement.closest('#csr-window') ||
                            node.parentElement.tagName === 'SCRIPT' ||
                            node.parentElement.tagName === 'STYLE' ||
                            node.parentElement.classList.contains('csr-highlight')) { // Don't re-process our own highlights
                            return NodeFilter.FILTER_REJECT;
                        }

                        // Basic visibility check (may need refinement for complex CSS)
                        let currentElement = node.parentElement;
                        let isVisible = true;
                        while(currentElement && currentElement !== activeEditorElement.ownerDocument.body && currentElement !== activeEditorElement) {
                            if (window.getComputedStyle(currentElement).display === 'none' || window.getComputedStyle(currentElement).visibility === 'hidden') {
                                isVisible = false;
                                break;
                            }
                            currentElement = currentElement.parentElement;
                        }
                        if (!isVisible) return NodeFilter.FILTER_REJECT;

                        if (node.nodeValue.trim() === '') {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                },
                false
            );

            let node;
            while (node = treeWalker.nextNode()) {
                textNodes.push(node);
            }
        }
        return { nodes: textNodes, sourceElement: activeEditorElement };
    }

    function findMatchesInContent(contentNodes, term, options) {
        const foundMatches = [];
        if (!term || !contentNodes || contentNodes.length === 0) {
            updateResultsDisplay(true);
            return foundMatches;
        }

        const flags = options.caseSensitive ? 'g' : 'gi';
        let searchRegex;

        if (options.regex) {
            try {
                if (!term.trim()) { // Empty regex is invalid
                     resultsCountDisplay.textContent = 'No results';
                     return foundMatches;
                }
                searchRegex = new RegExp(term, flags);
            } catch (e) {
                resultsCountDisplay.textContent = 'Invalid Regex';
                return foundMatches;
            }
        } else {
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (!escapedTerm.trim()) {
                 resultsCountDisplay.textContent = 'No results';
                 return foundMatches;
            }
            if (options.wholeWord) {
                searchRegex = new RegExp(`\\b${escapedTerm}\\b`, flags);
            } else {
                searchRegex = new RegExp(escapedTerm, flags);
            }
        }

        contentNodes.forEach(textNode => {
            let match;
            const nodeText = textNode.nodeValue;
            // Reset lastIndex for global regex on each new nodeText
            if (searchRegex.global) searchRegex.lastIndex = 0;

            while ((match = searchRegex.exec(nodeText)) !== null) {
                 // Ensure match is not empty (e.g. from `\b` at string end)
                if (match[0].length === 0) {
                    if (searchRegex.lastIndex >= nodeText.length) break; // prevent infinite loop if zero-length match at end
                    searchRegex.lastIndex++; // advance past zero-length match
                    continue;
                }
                foundMatches.push({
                    node: textNode,
                    startOffset: match.index,
                    endOffset: match.index + match[0].length,
                    text: match[0]
                });
                if (!searchRegex.global) break;
            }
        });
        return foundMatches;
    }

    function navigateToMatch(index) {
        if (searchState.matches.length === 0 || index < 0 || index >= searchState.matches.length) {
             if (searchState.matches.length > 0) searchState.currentIndex = -1; // Reset if index is bad but matches exist
             updateResultsDisplay();
             return;
        }
        const matchData = searchState.matches[index];
        if (!matchData || !matchData.element) {
            console.warn("CSR: Attempted to navigate to invalid match data or element", index, matchData);
            return;
        }


        if (searchState.currentIndex !== -1 &&
            searchState.matches[searchState.currentIndex] &&
            searchState.matches[searchState.currentIndex].element) {
            searchState.matches[searchState.currentIndex].element.classList.remove('csr-current-match');
        }

        searchState.currentIndex = index;
        const currentMatchElement = matchData.element;

        currentMatchElement.classList.add('csr-current-match');

        if (typeof currentMatchElement.scrollIntoViewIfNeeded === 'function') {
            currentMatchElement.scrollIntoViewIfNeeded(false);
        } else {
            currentMatchElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        }

        // searchInput.focus();
        updateResultsDisplay();
    }

    /**
     * Navigates to a specific match by its index in the searchState.matches array.
     * Handles navigation differently for DOM matches (scrolls to <mark> element)
     * and textarea matches (selects text and scrolls textarea).
     * @param {number} index - The index of the match to navigate to.
     */
    function navigateToMatch(index) {
        if (searchState.matches.length === 0 || index < 0 || index >= searchState.matches.length) {
             // If current index was valid, attempt to remove its 'current-match' class (for DOM)
             if (searchState.currentIndex !== -1 &&
                 searchState.matches.length > searchState.currentIndex && // Check if old currentIndex is still in bounds (it might not be if matches were cleared)
                 currentEditorType === 'dom' &&
                 searchState.matches[searchState.currentIndex] &&
                 searchState.matches[searchState.currentIndex].element) {
                 searchState.matches[searchState.currentIndex].element.classList.remove('csr-current-match');
             }
             searchState.currentIndex = -1;
             updateResultsDisplay();
             return;
        }
        const matchData = searchState.matches[index];

        if (matchData.isTextareaMatch) {
            navigateToTextareaMatch(matchData, index); // This function handles its own currentIndex and display update.
        } else { // DOM match
            if (!matchData || !matchData.element) {
                // console.warn("CSR: Attempted to navigate to invalid DOM match data or element", index, matchData);
                return;
            }

            // Remove .csr-current-match from the previously current DOM element
            if (searchState.currentIndex !== -1 &&
                searchState.matches[searchState.currentIndex] &&
                !searchState.matches[searchState.currentIndex].isTextareaMatch && // Ensure it was a DOM match
                searchState.matches[searchState.currentIndex].element) {
                searchState.matches[searchState.currentIndex].element.classList.remove('csr-current-match');
            }

            searchState.currentIndex = index;
            const currentMatchElement = matchData.element;
            currentMatchElement.classList.add('csr-current-match');

            if (typeof currentMatchElement.scrollIntoViewIfNeeded === 'function') {
                currentMatchElement.scrollIntoViewIfNeeded(false);
            } else {
                currentMatchElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            }
            updateResultsDisplay();
        }
    }

    function navigateToNextMatch() {
        if (searchState.matches.length === 0) return;
        let nextIndex = searchState.currentIndex + 1;
        if (nextIndex >= searchState.matches.length) {
            nextIndex = 0;
        }
        navigateToMatch(nextIndex);
    }

    function navigateToPrevMatch() {
        if (searchState.matches.length === 0) return;
        let prevIndex = searchState.currentIndex - 1;
        if (prevIndex < 0) {
            prevIndex = searchState.matches.length - 1;
        }
        navigateToMatch(prevIndex);
    }

    function updateResultsDisplay(noSearchTermOrContent = false) {
        if (noSearchTermOrContent && !searchState.searchTerm) {
             resultsCountDisplay.textContent = '';
             return;
        }
        if (searchState.matches.length === 0) {
            resultsCountDisplay.textContent = searchState.searchTerm.trim() ? 'No results' : '';
        } else {
            resultsCountDisplay.textContent = `${searchState.currentIndex + 1} of ${searchState.matches.length}`;
        }
    }

    // Add new CSS for .csr-highlight and .csr-current-match
    // Ensures these styles are available without needing to modify the theme's CSS
    const styleId = 'csr-highlight-styles';
    if (!document.getElementById(styleId)) {
        const styleSheet = document.createElement("style");
        styleSheet.id = styleId;
        styleSheet.type = "text/css";
        styleSheet.innerText = `
            .csr-highlight { background-color: #fde25b !important; color: #000 !important; }
            .csr-current-match { background-color: #ff9632 !important; outline: 1px solid #ad4b00 !important; }
        `;
        document.head.appendChild(styleSheet);
    }


    // Function to open the search window
    function openSearchWindow() {
        csrWindow.style.display = 'block';
        csrWindow.setAttribute('aria-hidden', 'false');
        searchInput.focus();
        const selectedText = getSelectedTextFromEditor();
        if (selectedText) {
            searchInput.value = selectedText;
            searchInput.select();
        }
    }

    // Function to close the search window
    function closeSearchWindow() {
        csrWindow.style.display = 'none';
        csrWindow.setAttribute('aria-hidden', 'true');
        // Consider returning focus to the editor or a more appropriate element
    }

    // Event listener for Ctrl+F / Cmd+F
    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            if (window.getComputedStyle(csrWindow).display === 'none') {
                openSearchWindow();
            } else {
                searchInput.focus();
                searchInput.select();
            }
        }

        if (e.key === 'Escape' && window.getComputedStyle(csrWindow).display !== 'none') {
            e.preventDefault();
            closeSearchWindow();
        }
    });

    // Event listener for the close button
    closeButton.addEventListener('click', closeSearchWindow);

    // Event listener for toggling replace mode
    toggleReplaceModeButton.addEventListener('click', function() {
        const isReplaceVisible = window.getComputedStyle(replaceControls).display !== 'none';
        if (isReplaceVisible) {
            replaceControls.style.display = 'none';
            modeIndicator.textContent = 'Search';
            // Update toggle button icon/title if it changes state (e.g. arrow down vs arrow right)
            // For the current icon, it visually represents "expand/collapse" or "show/hide" details.
            // If using distinct icons for "search mode" and "replace mode" toggle, update here.
            toggleReplaceModeButton.setAttribute('aria-expanded', 'false');
            toggleReplaceModeButton.title = 'Show Replace Options';


        } else {
            replaceControls.style.display = 'block';
            modeIndicator.textContent = 'Search & Replace';
            toggleReplaceModeButton.setAttribute('aria-expanded', 'true');
            toggleReplaceModeButton.title = 'Hide Replace Options';


        }
    });


    /**
     * Gets selected text from the active WordPress editor.
     * This needs robust implementation for both TinyMCE and Gutenberg.
     */
    function getSelectedTextFromEditor() {
        let selectedText = '';
        let activeDoc = document; // Assume main document initially

        // Check for Gutenberg iframe context
        const gutenbergIframe = document.querySelector('.block-editor__editor-skeleton iframe[name="editor-canvas"]');
        if (gutenbergIframe && gutenbergIframe.contentDocument && gutenbergIframe.contentDocument.hasFocus()) {
            activeDoc = gutenbergIframe.contentDocument;
        }

        // Try for Gutenberg (Block Editor) - using activeDoc for selection
        if (typeof wp !== 'undefined' && wp.data && typeof wp.data.select === 'function') {
            try {
                // First, try to get selection from where the focus actually is (main window or iframe)
                const currentSelection = activeDoc.getSelection();
                if (currentSelection && currentSelection.rangeCount > 0) {
                    selectedText = currentSelection.toString();
                }

                // If no text from direct selection, and Gutenberg objects are available,
                // this part might be redundant if activeDoc.getSelection() worked,
                // but could be a fallback if selection is programmatic or complex.
                // For now, relying on activeDoc.getSelection() should be primary for Gutenberg.
                // const editor = wp.data.select('core/block-editor');
                // if (editor && !selectedText) { ... }

            } catch (err) {
                console.warn('CSR: Error accessing Gutenberg selection:', err);
            }
        }

        // Try for TinyMCE (Classic Editor) if no text from Gutenberg
        // TinyMCE usually manages its own selection context well.
        if (!selectedText && typeof tinymce !== 'undefined' && tinymce.activeEditor && !tinymce.activeEditor.isHidden()) {
            try {
                selectedText = tinymce.activeEditor.selection.getContent({ format: 'text' });
            } catch (err) {
                console.warn('CSR: Error accessing TinyMCE selection:', err);
            }
        }

        // Fallback to activeDoc.getSelection() if specific editor APIs didn't yield text
        if (!selectedText) {
            const currentSelection = activeDoc.getSelection();
            if (currentSelection && currentSelection.rangeCount > 0) {
                selectedText = currentSelection.toString();
            }
        }

        return selectedText.trim();
    }

    // Initial setup for toggle button state if needed
    const isReplaceInitiallyVisible = window.getComputedStyle(replaceControls).display !== 'none';
    toggleReplaceModeButton.setAttribute('aria-expanded', isReplaceInitiallyVisible.toString());
    if(isReplaceInitiallyVisible){
        modeIndicator.textContent = csr_i18n.replace_mode_title || 'Search & Replace';
        toggleReplaceModeButton.title = csr_i18n.hide_replace_options || 'Hide Replace Options';
    } else {
        modeIndicator.textContent = csr_i18n.search_mode_title || 'Search';
        toggleReplaceModeButton.title = csr_i18n.show_replace_options || 'Show Replace Options';
    }

    // Apply localized placeholders if not already set by PHP (e.g. if HTML was cached or JS creates elements)
    // Though it's better if PHP sets these directly in the HTML. This is a fallback.
    if (searchInput.placeholder !== (csr_i18n.search_placeholder || 'Search')) {
        searchInput.placeholder = csr_i18n.search_placeholder || 'Search';
    }
    if (replaceInput.placeholder !== (csr_i18n.replace_placeholder || 'Replace')) {
        replaceInput.placeholder = csr_i18n.replace_placeholder || 'Replace';
    }

    // Function to handle the keydown event
    function handleKeyDown(e) {
        // console.log('CSR: Keydown event detected on:', e.currentTarget.constructor.name, e.key, e.ctrlKey, e.metaKey, e.target); // Detailed DEBUG
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { // toLowerCase for 'f'
            console.log('CSR: Ctrl+F / Cmd+F detected.'); // DEBUG
            e.preventDefault();
            e.stopPropagation();
            if (window.getComputedStyle(csrWindow).display === 'none') {
                openSearchWindow();
            } else {
                searchInput.focus();
                searchInput.select();
            }
            return;
        }

        if (e.key === 'Escape' && window.getComputedStyle(csrWindow).display !== 'none') {
            console.log('CSR: Escape key detected, closing window.'); // DEBUG
            e.preventDefault();
            e.stopPropagation();
            closeSearchWindow();
            return;
        }
    }

    // Attach keydown listener to the main document
    document.addEventListener('keydown', handleKeyDown);
    console.log('CSR: Attached keydown listener to main document.'); // DEBUG

    // Function to try and attach listener to editor iframes
    function attachToEditorIFrames() {
        console.log('CSR: Attempting to attach listeners to iframes.'); // DEBUG
        // For Classic Editor (TinyMCE)
        const tinyMCEIframe = document.getElementById('content_ifr');
        if (tinyMCEIframe) {
            if (tinyMCEIframe.contentDocument) {
                try {
                    tinyMCEIframe.contentDocument.removeEventListener('keydown', handleKeyDown); // Remove if already attached
                    tinyMCEIframe.contentDocument.addEventListener('keydown', handleKeyDown);
                    console.log('CSR: Attached keydown listener to TinyMCE iframe.'); // DEBUG
                } catch (err) {
                    console.warn('CSR: Error attaching keydown listener to TinyMCE iframe:', err);
                }
            } else {
                 console.log('CSR: TinyMCE iframe found, but contentDocument not accessible yet.'); // DEBUG
            }
        } else {
            // console.log('CSR: TinyMCE iframe (#content_ifr) not found.'); // DEBUG
        }

        // For Gutenberg iframe mode (if applicable)
        const gutenbergCanvasIframe = document.querySelector('.block-editor__editor-skeleton iframe[name="editor-canvas"]');
        if (gutenbergCanvasIframe) {
            if (gutenbergCanvasIframe.contentDocument) {
                try {
                    gutenbergCanvasIframe.contentDocument.removeEventListener('keydown', handleKeyDown); // Remove if already attached
                    gutenbergCanvasIframe.contentDocument.addEventListener('keydown', handleKeyDown);
                    console.log('CSR: Attached keydown listener to Gutenberg canvas iframe.'); // DEBUG
                } catch (err) {
                    console.warn('CSR: Error attaching keydown listener to Gutenberg canvas iframe:', err);
                }
            } else {
                console.log('CSR: Gutenberg canvas iframe found, but contentDocument not accessible yet.'); // DEBUG
            }
        } else {
            // console.log('CSR: Gutenberg canvas iframe not found.'); // DEBUG
        }
    }

    // Initial attempt and then retry mechanism
    attachToEditorIFrames(); // Initial try

    // Fallback for iframes loading later
    // Using 'load' on window might be too late for iframes already in DOM but not fully initialized.
    // A MutationObserver on the body for iframe additions could be more robust but is more complex.
    // setInterval is not ideal, but as a fallback for retrying:
    let attachAttempts = 0;
    const attachInterval = setInterval(() => {
        attachToEditorIFrames(); // This function now logs internally if it attaches or not
        attachAttempts++;
        if (attachAttempts >= 5) {
            clearInterval(attachInterval);
            // console.log('CSR: Stopped interval for attaching to iframes.'); // DEBUG
        }
    }, 1000);

    /**
     * Determines the active editor and retrieves its content.
     * Prioritizes Gutenberg Code Editor, then active visual editors (Gutenberg/TinyMCE),
     * then falls back to checking common textarea/DOM structures.
     * @returns {object} An object containing:
     *  - `nodes`: Array of text nodes (for 'dom' type) or empty array (for 'textarea').
     *  - `sourceElement`: The main DOM element of the editor (e.g., textarea or visual editor's root).
     *  - `type`: String, either 'dom' or 'textarea'.
     *  - `text`: String, the full text content (primarily for 'textarea' type).
     */
    function getEditorContent() {
        let activeEditorElement = null;
        const textNodes = [];
        let contentType = 'dom';
        let rawTextContent = '';

        // console.log("CSR: getEditorContent called"); // DEBUG

        // 1. Check for Gutenberg Code Editor (Text Mode) / HTML Editor
        // This mode uses a textarea for direct HTML/text input.
        const gutenbergTextEditorTextarea = document.querySelector('textarea.block-editor-plain-text, textarea.editor-post-text-editor__body');
        if (gutenbergTextEditorTextarea &&
            (gutenbergTextEditorTextarea.offsetParent !== null || gutenbergTextEditorTextarea.closest('.is-active'))) { // Check visibility/activity
            // console.log("CSR: Gutenberg Text Editor (Code Mode) detected.", gutenbergTextEditorTextarea); // DEBUG
            activeEditorElement = gutenbergTextEditorTextarea;
            contentType = 'textarea';
            rawTextContent = gutenbergTextEditorTextarea.value;
            return { nodes: [], sourceElement: activeEditorElement, type: contentType, text: rawTextContent };
        }

        // 2. Check for active visual editors (Gutenberg Visual or TinyMCE)
        let visualEditorRoot = isGutenbergActive(); // Returns DOM element or null
        if (visualEditorRoot) {
            // console.log("CSR: Gutenberg Visual Editor detected as active.", visualEditorRoot); // DEBUG
            activeEditorElement = visualEditorRoot;
            contentType = 'dom';
        } else {
            visualEditorRoot = isTinyMCEActive(); // Returns DOM element or null
            if (visualEditorRoot) {
                // console.log("CSR: TinyMCE Visual Editor detected as active.", visualEditorRoot); // DEBUG
                activeEditorElement = visualEditorRoot;
                contentType = 'dom';
            }
        }

        // 3. Fallback if no specific active editor was clearly identified by the above
        if (!activeEditorElement) {
            // console.log("CSR: No specific active editor, attempting fallback scan."); // DEBUG
            // Try to find a generic content area, could be either a textarea or a rich text area
            const classicTextarea = document.getElementById('content'); // Classic editor textarea (if TinyMCE not initialized or in text mode)
            const gutenbergMainArea = document.querySelector('.editor-styles-wrapper'); // Common Gutenberg wrapper
            const tinyMceIframeBody = document.getElementById('content_ifr')?.contentDocument?.body;

            if (classicTextarea && classicTextarea.offsetParent !== null && classicTextarea.tagName === 'TEXTAREA' && !tinyMceIframeBody) {
                 // Check if classic editor is in Text mode (TinyMCE iframe would not exist or be hidden)
                const classicEditorTextModeActive = document.body.classList.contains('html-editor'); // WordPress adds this class
                if (classicEditorTextModeActive || (document.getElementById('wp-content-wrap') && document.getElementById('wp-content-wrap').classList.contains('html-editor'))) {
                    // console.log("CSR: Classic Editor in Text Mode detected (fallback).", classicTextarea); // DEBUG
                    activeEditorElement = classicTextarea;
                    contentType = 'textarea';
                    rawTextContent = classicTextarea.value;
                    return { nodes: [], sourceElement: activeEditorElement, type: contentType, text: rawTextContent };
                }
            }

            // If not a textarea, assume DOM-based editor from fallbacks
            activeEditorElement = tinyMceIframeBody || gutenbergMainArea || classicTextarea /* if it wasn't textarea mode */;
            if (activeEditorElement) contentType = 'dom'; // Assume dom if element found but not textarea
            // console.log("CSR: Fallback editor element found:", activeEditorElement); // DEBUG
        }

        if (activeEditorElement && contentType === 'dom') {
            // console.log("CSR: Processing active DOM editor element:", activeEditorElement); // DEBUG
            const treeWalkerAcceptNode = {
                acceptNode: function (node) {
                    if (node.parentElement.closest('#csr-window') ||
                        node.parentElement.tagName === 'SCRIPT' ||
                        node.parentElement.tagName === 'STYLE' ||
                        node.parentElement.classList.contains('csr-highlight')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    let currentElement = node.parentElement;
                    let isVisible = true;
                    const ownerDoc = activeEditorElement.ownerDocument || activeEditorElement; // Handle iframe body
                    while(currentElement && currentElement !== ownerDoc.body && currentElement !== activeEditorElement) {
                        if (window.getComputedStyle(currentElement).display === 'none' || window.getComputedStyle(currentElement).visibility === 'hidden') {
                            isVisible = false;
                            break;
                        }
                        currentElement = currentElement.parentElement;
                    }
                    if (!isVisible) return NodeFilter.FILTER_REJECT;
                    if (node.nodeValue.trim() === '') return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            };

            const treeWalkerInstance = (activeEditorElement.ownerDocument || document).createTreeWalker(
                activeEditorElement,
                NodeFilter.SHOW_TEXT,
                treeWalkerAcceptNode,
                false
            );
            let node;
            while (node = treeWalkerInstance.nextNode()) {
                textNodes.push(node);
            }
            // if(textNodes.length === 0 && activeEditorElement.innerText && activeEditorElement.innerText.trim() !== '') console.log("CSR: TreeWalker found 0 text nodes, but element has innerText."); // DEBUG
        } else if (!activeEditorElement) {
            // console.warn("CSR: No active editor element could be determined for content retrieval."); // DEBUG
        }

        return { nodes: textNodes, sourceElement: activeEditorElement, type: contentType, text: rawTextContent };
    }

    /**
     * Finds all occurrences of a search term in the provided editor content.
     * Handles both DOM node arrays (from visual editors) and plain text (from textareas).
     * @param {object} editorData - The object returned by getEditorContent().
     * @param {string} term - The search term.
     * @param {object} options - Search options (regex, caseSensitive, wholeWord).
     * @returns {Array<object>} An array of match objects. Each object contains:
     *  - `node`: The text node (for DOM) or the textarea element.
     *  - `startOffset`: Start index of the match within the node's text or textarea's value.
     *  - `endOffset`: End index of the match.
     *  - `text`: The matched text itself.
     *  - `isTextareaMatch`: Boolean, true if the match is from a textarea.
     *  - `element`: (For DOM matches only, after highlighting) The <mark> element used for highlighting.
     */
    function findMatchesInContent(editorData, term, options) {
        const foundMatches = [];
        if (!term.trim() || // Exit early if term is empty or only whitespace
            !editorData ||
            (editorData.type === 'dom' && (!editorData.nodes || !Array.isArray(editorData.nodes))) ||
            (editorData.type === 'textarea' && typeof editorData.text !== 'string')) {

            if (term.trim()) { // Only show "No results" if there was a non-empty search term
                updateResultsDisplay(true, csr_i18n.no_results || 'No results');
            } else {
                updateResultsDisplay(true, ""); // Clear display if search term was empty
            }
            return foundMatches;
        }

        const flags = options.caseSensitive ? 'g' : 'gi';
        let searchRegex;
        let searchTermForRegex = term;

        // console.log(`CSR: findMatchesInContent - Term: "${term}", RegexOpt: ${options.regex}, CaseOpt: ${options.caseSensitive}, WholeOpt: ${options.wholeWord}`); // DEBUG

        if (options.regex) {
            if (!searchTermForRegex.trim()) {
                 updateResultsDisplay(true, ""); // Clear if regex term is effectively empty
                 return foundMatches;
            }
            try {
                searchRegex = new RegExp(searchTermForRegex, flags);
                // console.log("CSR: Created Regex:", searchRegex); // DEBUG
            } catch (e) {
                // console.error("CSR: Invalid Regular Expression:", e); // DEBUG
                updateResultsDisplay(true, csr_i18n.invalid_regex || 'Invalid Regex');
                return foundMatches;
            }
        } else {
            searchTermForRegex = searchTermForRegex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (!searchTermForRegex.trim()) {
                 updateResultsDisplay(true, ""); // Clear if escaped term is effectively empty
                 return foundMatches;
            }
            if (options.wholeWord) {
                searchRegex = new RegExp(`\\b${searchTermForRegex}\\b`, flags);
            } else {
                searchRegex = new RegExp(searchTermForRegex, flags);
            }
            // console.log("CSR: Created Literal Regex:", searchRegex); // DEBUG
        }

        if (editorData.type === 'textarea') {
            // console.log("CSR: Searching in textarea content"); // DEBUG
            const textContent = editorData.text;
            let match;
            if (searchRegex.global) searchRegex.lastIndex = 0;
            while ((match = searchRegex.exec(textContent)) !== null) {
                if (match[0].length === 0) {
                    if (searchRegex.lastIndex >= textContent.length && searchRegex.global) break;
                    if (searchRegex.global) searchRegex.lastIndex++;
                    else break; // Prevent infinite loop for non-global zero-length match
                    continue;
                }
                foundMatches.push({
                    node: editorData.sourceElement,
                    startOffset: match.index,
                    endOffset: match.index + match[0].length,
                    text: match[0],
                    isTextareaMatch: true
                });
                if (!searchRegex.global) break;
            }
        } else if (editorData.nodes && editorData.nodes.length > 0) {
            // console.log("CSR: Searching in DOM nodes", editorData.nodes.length); // DEBUG
            editorData.nodes.forEach(textNode => {
                let match;
                const nodeText = textNode.nodeValue;
                if (searchRegex.global) searchRegex.lastIndex = 0;
                while ((match = searchRegex.exec(nodeText)) !== null) {
                    if (match[0].length === 0) {
                        if (searchRegex.lastIndex >= nodeText.length && searchRegex.global) break;
                        if (searchRegex.global) searchRegex.lastIndex++;
                        else break;
                        continue;
                    }
                    foundMatches.push({
                        node: textNode,
                        startOffset: match.index,
                        endOffset: match.index + match[0].length,
                        text: match[0],
                        isTextareaMatch: false
                    });
                    if (!searchRegex.global) break;
                }
            });
        } else {
            // console.log("CSR: No nodes to search in DOM mode, or unknown type. Editor Source:", editorData.sourceElement); // DEBUG
        }

        // Update display based on whether matches were found AND if there was a search term
        if (foundMatches.length === 0 && term.trim() !== "") {
            updateResultsDisplay(true, (csr_i18n.no_results || 'No results'));
        } else if (term.trim() === "" && foundMatches.length === 0) { // Term was empty or became empty
             updateResultsDisplay(true, ""); // Clear display, no "No results" needed
        }
        // If matches are found, updateResultsDisplay will be called by performSearch after sorting.
        return foundMatches;
    }


    // Update dynamic text using csr_i18n
    // Example: updateResultsDisplay function needs to use csr_i18n strings.
    // Already handled in the previous diff for updateResultsDisplay, just confirming its usage.
    // function updateResultsDisplay(noSearchTermOrContent = false) {
    //     if (noSearchTermOrContent && !searchState.searchTerm) {
    //          resultsCountDisplay.textContent = ''; // No specific string for "empty search term, nothing to display"
    //          return;
    //     }
    //     if (searchState.matches.length === 0) {
    //         resultsCountDisplay.textContent = searchState.searchTerm.trim() ? csr_i18n.no_results : '';
    //     } else {
    //         resultsCountDisplay.textContent = csr_i18n.results_count_text
    //                                             .replace('%1$s', searchState.currentIndex + 1)
    //                                             .replace('%2$s', searchState.matches.length);
    //     }
    // }
    // Note: The above example for updateResultsDisplay was already implemented.
    // Similar changes would have been made to:
    // - `toggleReplaceModeButton.title` updates within its event listener
    // - `resultsCountDisplay.textContent` for 'Invalid Regex', 'No more matches', etc.
    // These were mostly done when adding the logic for those messages. I'll double check.

    // Ensure all user-visible strings set by JS use csr_i18n
    // Reviewing functions:
    // - toggleReplaceModeButton click listener:
    //      - modeIndicator.textContent = isReplaceVisible ? csr_i18n.search_mode_title : csr_i18n.replace_mode_title;
    //      - toggleReplaceModeButton.title = isReplaceVisible ? csr_i18n.show_replace_options : csr_i18n.hide_replace_options;
    // - findMatchesInContent:
    //      - resultsCountDisplay.textContent = csr_i18n.invalid_regex; (if regex error)
    //      - resultsCountDisplay.textContent = csr_i18n.no_results; (if term is empty after escaping)
    // - replaceOneMatch:
    //      - resultsCountDisplay.textContent = csr_i18n.all_matches_replaced;
    //      - resultsCountDisplay.textContent = csr_i18n.error_during_replacement;
    // - replaceAllMatches:
    //      - resultsCountDisplay.textContent = csr_i18n.replaced_n_occurrences.replace('%d', replacedCount);

    // The previous diffs that introduced these text updates in JS should already use csr_i18n.
    // This step is largely a confirmation and ensuring the initial setup (placeholders, initial titles) also uses them.
});
