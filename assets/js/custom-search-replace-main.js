document.addEventListener('DOMContentLoaded', function () {
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
        matches: [], // Array to store match objects {node, startOffset, endOffset, text, element}
        currentIndex: -1,
        options: {
            regex: false,
            caseSensitive: false,
            wholeWord: false,
            preserveCase: false // Added for replace mode
        },
        highlightedSpans: [] // To keep track of created <mark> elements
    };

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

    function performSearch() {
        if (!searchState.searchTerm) {
            clearSearch(); // This will also update display
            return;
        }

        clearHighlights();
        searchState.matches = [];
        searchState.currentIndex = -1;
        searchState.highlightedSpans = [];


        const editorContent = getEditorContent();
        if (!editorContent.nodes || editorContent.nodes.length === 0) {
            updateResultsDisplay();
            return;
        }

        const rawMatches = findMatchesInContent(editorContent.nodes, searchState.searchTerm, searchState.options);

        // Highlight and store valid matches
        rawMatches.forEach(matchData => {
            const markElement = highlightMatchInNode(matchData.node, matchData.startOffset, matchData.endOffset);
            if (markElement) {
                matchData.element = markElement; // Store the actual <mark> element
                searchState.matches.push(matchData); // Add to confirmed matches
                searchState.highlightedSpans.push(markElement);
            }
        });

        // Sort matches by their document order to ensure consistent navigation
        // This is crucial because node traversal might not always yield elements in perfect document order,
        // especially if editor content is complex or modified during the process.
        if (searchState.matches.length > 1) {
            searchState.matches.sort((a, b) => {
                if (!a.element || !b.element) return 0; // Should not happen if markElement was successful
                const pos = a.element.compareDocumentPosition(b.element);
                if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1; // a is before b
                if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;  // a is after b
                return 0;
            }).reverse(); // .reverse() because FOLLOWING means it comes after, PRECEDING means before. We want top-to-bottom.
        }

        updateResultsDisplay();

        if (searchState.matches.length > 0) {
            navigateToMatch(0);
        } else {
             searchInput.focus(); // Keep focus if no matches
        }
    }

    function clearSearch() {
        clearHighlights();
        searchState.matches = [];
        searchState.currentIndex = -1;
        // searchState.searchTerm remains in the input
        updateResultsDisplay();
    }

    function clearHighlights() {
        // Remove 'current match' styling from any previous match
        if (searchState.currentIndex !== -1 &&
            searchState.matches[searchState.currentIndex] &&
            searchState.matches[searchState.currentIndex].element) {
            searchState.matches[searchState.currentIndex].element.classList.remove('csr-current-match');
        }

        searchState.highlightedSpans.forEach(span => {
            if (span && span.parentNode) {
                const textNode = document.createTextNode(span.textContent);
                try {
                    span.parentNode.replaceChild(textNode, span);
                    textNode.parentNode.normalize();
                } catch (e) {
                    console.warn("CSR: Error un-highlighting node:", e, span);
                }
            }
        });
        searchState.highlightedSpans = [];
    }

    function highlightMatchInNode(textNode, startOffset, endOffset) {
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE || startOffset < 0 || endOffset < 0 || endOffset <= startOffset) {
            return null;
        }

        const originalText = textNode.nodeValue;
        if (startOffset >= originalText.length || endOffset > originalText.length) {
             console.warn("CSR: Invalid offsets for highlighting.", textNode, startOffset, endOffset, originalText.length);
             return null;
        }

        const matchText = originalText.substring(startOffset, endOffset);
        if (!matchText) return null;

        try {
            const mark = document.createElement('mark');
            mark.className = 'csr-highlight';
            mark.textContent = matchText;

            // Split the text node: before, match, after
            let middleBit = textNode.splitText(startOffset); // textNode is now 'before'
            let afterBit = middleBit.splitText(matchText.length); // middleBit is now 'match', afterBit is 'after'

            const parent = textNode.parentNode; // Or middleBit.parentNode before it's replaced
            if (parent) {
                parent.replaceChild(mark, middleBit); // Replace the 'match' text part with the <mark>
                return mark;
            }
        } catch (e) {
            console.error("CSR: Error highlighting node:", e, {tn: textNode.nodeValue, so:startOffset, eo:endOffset});
            // If splitText fails, or parent is null. Try to restore original node if possible.
            // This part is tricky; ideally, the conditions at the start prevent most errors.
            if (textNode && textNode.nodeValue !== originalText) { // If splitText partially succeeded
                 // Attempt to merge them back if they are siblings. This is a simplification.
                 // A more robust solution would involve a full DOM state rollback or more careful splitting.
                 if (textNode.parentNode) textNode.parentNode.normalize();
            }
            return null;
        }
        return null;
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

        // searchInput.focus(); // Re-focusing can be jarring if user is trying to see the match
        updateResultsDisplay();
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
