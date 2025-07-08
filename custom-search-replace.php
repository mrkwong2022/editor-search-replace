<?php
/**
 * Plugin Name:       Custom Search and Replace
 * Plugin URI:        https://example.com/custom-search-replace
 * Description:       Adds a VS Code-like search and replace functionality to the WordPress editor using Ctrl+F/Cmd+F.
 * Version:           1.0.0
 * Author:            Your Name or Company
 * Author URI:        https://example.com/
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       custom-search-replace
 * Domain Path:       /languages
 */

// If this file is called directly, abort.
if ( ! defined( 'WPINC' ) ) {
	die;
}

/**
 * Currently plugin version.
 */
define( 'CUSTOM_SEARCH_REPLACE_VERSION', '1.0.0' );

/**
 * Load plugin textdomain.
 */
function csr_load_textdomain() {
    load_plugin_textdomain(
        'custom-search-replace',
        false,
        dirname( plugin_basename( __FILE__ ) ) . '/languages'
    );
}
add_action( 'plugins_loaded', 'csr_load_textdomain' );

/**
 * Enqueue scripts and styles.
 */
function csr_enqueue_scripts() {
    // Only enqueue on admin pages where post editing occurs
    $screen = get_current_screen();
    if ( ! $screen || ! in_array( $screen->base, array( 'post', 'page' ), true ) && ! $screen->is_block_editor() ) {
        return;
    }

    wp_enqueue_style(
        'custom-search-replace-styles',
        plugin_dir_url( __FILE__ ) . 'assets/css/custom-search-replace-styles.css',
        array(),
        CUSTOM_SEARCH_REPLACE_VERSION
    );

    wp_enqueue_script(
        'custom-search-replace-main-js',
        plugin_dir_url( __FILE__ ) . 'assets/js/custom-search-replace-main.js',
        array( 'jquery' ), // Add dependencies if needed, e.g., jQuery
        CUSTOM_SEARCH_REPLACE_VERSION,
        true // Load in footer
    );

    $localized_strings = array(
        'search_placeholder'        => esc_attr__( 'Search', 'custom-search-replace' ), // Will be used by JS if needed, but also set in HTML
        'replace_placeholder'       => esc_attr__( 'Replace', 'custom-search-replace' ), // Will be used by JS if needed, but also set in HTML
        'toggle_replace_mode_title' => esc_attr__( 'Toggle Replace Mode', 'custom-search-replace' ), // Used by JS to update title
        'show_replace_options'      => esc_attr__( 'Show Replace Options', 'custom-search-replace' ), // Used by JS
        'hide_replace_options'      => esc_attr__( 'Hide Replace Options', 'custom-search-replace' ), // Used by JS
        // 'close_title'               => esc_attr__( 'Close (Esc)', 'custom-search-replace' ), // Set in HTML
        // 'regex_title'               => esc_attr__( 'Use Regular Expression (Alt+R)', 'custom-search-replace' ), // Set in HTML
        // 'case_title'                => esc_attr__( 'Match Case (Alt+C)', 'custom-search-replace' ), // Set in HTML
        // 'whole_word_title'          => esc_attr__( 'Match Whole Word (Alt+W)', 'custom-search-replace' ), // Set in HTML
        // 'preserve_case_title'       => esc_attr__( 'Preserve Case (Alt+P)', 'custom-search-replace' ), // Set in HTML
        // 'prev_match_title'          => esc_attr__( 'Previous Match (Shift+Enter)', 'custom-search-replace' ), // Set in HTML
        // 'next_match_title'          => esc_attr__( 'Next Match (Enter)', 'custom-search-replace' ), // Set in HTML
        // 'replace_one_title'         => esc_attr__( 'Replace', 'custom-search-replace' ), // Set in HTML (button text itself)
        // 'replace_all_title'         => esc_attr__( 'Replace All', 'custom-search-replace' ), // Set in HTML (button text itself)
        'results_count_text'        => esc_html__( '%1$s of %2$s', 'custom-search-replace' ), // %1$s for current, %2$s for total. Using %s for JS.
        'no_results'                => esc_html__( 'No results', 'custom-search-replace' ),
        'invalid_regex'             => esc_html__( 'Invalid Regex', 'custom-search-replace' ),
        'no_more_matches'           => esc_html__( 'No more matches', 'custom-search-replace' ),
        'all_matches_replaced'      => esc_html__( 'All matches replaced.', 'custom-search-replace' ),
        'error_during_replacement'  => esc_html__( 'Error during replacement.', 'custom-search-replace' ),
        'replaced_n_occurrences'    => esc_html__( 'Replaced %d occurrence(s).', 'custom-search-replace' ), // %d for JS
        'search_mode_title'         => esc_html__( 'Search', 'custom-search-replace' ), // For window title
        'replace_mode_title'        => esc_html__( 'Search & Replace', 'custom-search-replace' ), // For window title
    );

    wp_localize_script( 'custom-search-replace-main-js', 'csr_i18n', $localized_strings );
}
add_action( 'admin_enqueue_scripts', 'csr_enqueue_scripts' );

/**
 * Output the HTML for the search/replace window.
 */
function csr_output_search_replace_window_html() {
    // Only output on admin pages where post editing occurs
    $screen = get_current_screen();
    if ( ! $screen || ! in_array( $screen->base, array( 'post', 'page' ), true ) && ! $screen->is_block_editor() ) {
        return;
    }
    ?>
    <div id="csr-window" class="csr-window" style="display: none;" aria-hidden="true" role="dialog" aria-labelledby="csr-window-title">
        <div class="csr-header">
            <span id="csr-window-title" class="csr-mode-indicator-search"><?php echo esc_html__( 'Search', 'custom-search-replace' ); ?></span>
            <div class="csr-actions-right">
                <button id="csr-toggle-replace-mode" type="button" class="csr-icon-button" title="<?php echo esc_attr__( 'Toggle Replace Mode', 'custom-search-replace' ); ?>">
                    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1.5 1.5H14.5V2.5H1.5V1.5Z M1.5 4.5H14.5V5.5H1.5V4.5Z M1.5 7.5H9.5V8.5H1.5V7.5Z M1.5 10.5H9.5V11.5H1.5V10.5Z M11.5 7.5H14.5V11.5H11.5V7.5Z M12.2071 8.20711L11.5 8.91421V10.7929L12.2071 11.5H13.7929L14.5 10.7929V8.91421L13.7929 8.20711H12.2071Z"/>
                    </svg>
                    <span class="csr-sr-only"><?php echo esc_html__( 'Toggle Replace Mode', 'custom-search-replace' ); ?></span>
                </button>
                <button id="csr-close-button" type="button" class="csr-icon-button" title="<?php echo esc_attr__( 'Close (Esc)', 'custom-search-replace' ); ?>">
                    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2.34315 2.34315L13.6569 13.6569M2.34315 13.6569L13.6569 2.34315" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    <span class="csr-sr-only"><?php echo esc_html__( 'Close', 'custom-search-replace' ); ?></span>
                </button>
            </div>
        </div>

        <div class="csr-body">
            <div class="csr-search-controls">
                <div class="csr-input-group">
                    <input type="text" id="csr-search-input" class="csr-input" placeholder="<?php echo esc_attr__( 'Search', 'custom-search-replace' ); ?>" aria-label="<?php echo esc_attr__( 'Search', 'custom-search-replace' ); ?>">
                    <div class="csr-input-icons">
                        <button id="csr-regex-button" type="button" class="csr-icon-button" title="<?php echo esc_attr__( 'Use Regular Expression (Alt+R)', 'custom-search-replace' ); ?>">
                            <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 3.5H12.5V6H10.1974C9.96865 5.04918 9.07951 4.36557 8 4.36557C6.92049 4.36557 6.03135 5.04918 5.80261 6H3.5V3.5ZM8 5.36557C8.32091 5.36557 8.59124 5.54629 8.72205 5.80492L11.5 10.5H9.5V12.5H6.5V10.5H4.5L7.27795 5.80492C7.40876 5.54629 7.67909 5.36557 8 5.36557Z"/></svg>
                            <span class="csr-sr-only"><?php echo esc_html__( 'Use Regular Expression', 'custom-search-replace' ); ?></span>
                        </button>
                        <button id="csr-case-sensitive-button" type="button" class="csr-icon-button" title="<?php echo esc_attr__( 'Match Case (Alt+C)', 'custom-search-replace' ); ?>">
                            <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M2 2H5V3H6V4H7V5H8V11H7V12H6V13H5V14H2V13H3V12H4V11H5V5H4V4H3V3H2V2ZM10 2H13V3H12V4H11V5H10V11H11V12H12V13H13V14H10V13H11V12H12V11H13V5H12V4H11V3H10V2Z"/></svg>
                            <span class="csr-sr-only"><?php echo esc_html__( 'Match Case', 'custom-search-replace' ); ?></span>
                        </button>
                        <button id="csr-whole-word-button" type="button" class="csr-icon-button" title="<?php echo esc_attr__( 'Match Whole Word (Alt+W)', 'custom-search-replace' ); ?>">
                            <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M2 2H14V3H13V4H12V5H11V6H10V7H9V9H10V10H11V11H12V12H13V13H14V14H2V13H3V12H4V11H5V10H6V9H5V7H4V6H3V5H2V2ZM3 5H4V6H3V5ZM12 5H13V6H12V5ZM3 10H4V11H3V10ZM12 10H13V11H12V10Z"/></svg>
                            <span class="csr-sr-only"><?php echo esc_html__( 'Match Whole Word', 'custom-search-replace' ); ?></span>
                        </button>
                    </div>
                </div>
                <div class="csr-navigation-buttons">
                     <span id="csr-results-count" class="csr-results-count" aria-live="polite"><?php echo esc_html__( 'No results', 'custom-search-replace' ); ?></span>
                    <button id="csr-prev-match" type="button" class="csr-icon-button" title="<?php echo esc_attr__( 'Previous Match (Shift+Enter)', 'custom-search-replace' ); ?>">
                        <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <path d="M10.0708 4.9292L5.00008 9.99992L10.0708 15.0706L11.0708 14.0706L7.00008 9.99992L11.0708 5.9292L10.0708 4.9292Z"/>
                        </svg>
                        <span class="csr-sr-only"><?php echo esc_html__( 'Previous Match', 'custom-search-replace' ); ?></span>
                    </button>
                    <button id="csr-next-match" type="button" class="csr-icon-button" title="<?php echo esc_attr__( 'Next Match (Enter)', 'custom-search-replace' ); ?>">
                        <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <path d="M5.9292 4.9292L10.9999 9.99992L5.9292 15.0706L4.9292 14.0706L8.99992 9.99992L4.9292 5.9292L5.9292 4.9292Z"/>
                        </svg>
                        <span class="csr-sr-only"><?php echo esc_html__( 'Next Match', 'custom-search-replace' ); ?></span>
                    </button>
                </div>
            </div>

            <div id="csr-replace-controls" class="csr-replace-controls" style="display: none;">
                <div class="csr-input-group">
                    <input type="text" id="csr-replace-input" class="csr-input" placeholder="<?php echo esc_attr__( 'Replace', 'custom-search-replace' ); ?>" aria-label="<?php echo esc_attr__( 'Replace', 'custom-search-replace' ); ?>">
                    <div class="csr-input-icons">
                         <button id="csr-preserve-case-button" type="button" class="csr-icon-button" title="<?php echo esc_attr__( 'Preserve Case (Alt+P)', 'custom-search-replace' ); ?>">
                            <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M2 2H5V3H6V4H7V5H8V7H7V8H6V9H5V10H2V9H3V8H4V7H5V5H4V4H3V3H2V2ZM10 6H13V7H12V8H11V9H10V10H11V11H12V12H13V13H10V12H11V11H12V10H13V9H12V8H11V7H10V6Z M10 2H13V3H12V4H11V5H10V2Z"/></svg>
                            <span class="csr-sr-only"><?php echo esc_html__( 'Preserve Case', 'custom-search-replace' ); ?></span>
                         </button>
                    </div>
                </div>
                <div class="csr-action-buttons">
                    <button id="csr-replace-one-button" type="button" class="csr-button" title="<?php echo esc_attr__( 'Replace', 'custom-search-replace' ); ?>"><?php echo esc_html__( 'Replace', 'custom-search-replace' ); ?></button>
                    <button id="csr-replace-all-button" type="button" class="csr-button" title="<?php echo esc_attr__( 'Replace All', 'custom-search-replace' ); ?>"><?php echo esc_html__( 'Replace All', 'custom-search-replace' ); ?></button>
                </div>
            </div>
        </div>
    </div>
    <style>
        .csr-sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border-width: 0;
        }
    </style>
    <?php
}
// Add the HTML to the admin footer
add_action( 'admin_footer', 'csr_output_search_replace_window_html' );

// More plugin code will go here.
?>
