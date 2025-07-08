<?php
/**
 * Custom Search and Replace Uninstall
 *
 * Uninstalling Custom Search and Replace deletes nothing by default,
 * as it does not store any options or data in the database.
 *
 * @package CustomSearchReplace
 * @since 1.0.0
 */

// if uninstall.php is not called by WordPress, die
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
    die;
}

// Clear any transients or options if they were to be added in the future.
// Example:
// delete_option( 'csr_options' );
// delete_transient( 'csr_some_transient' );

// No options stored, so nothing to delete for now.
?>
