import { LightningElement, api, track } from 'lwc';
import LABEL_FILTER from '@salesforce/label/c.FDST_Filter';
import LABEL_REQUIRED_MESSAGE from '@salesforce/label/c.FDST_Validation_message_min_selection_required';

export default class DataSelectionTable extends LightningElement {
    // Input attributes
    @api in_records;                // {List<SObject>}  List of all records which should be available/selectable in the component
    @api in_displayFieldsString;    // {String}         Comma-separated API Field names to display
    @api in_displayLabelsString;    // {String}         Opt. Comma-separated Labels for columns/labels to display
    @api in_filterFieldsString;     // {String}         Opt. Comma-separated API Field names to allow filtering on
    @api in_filterLabelsString;     // {String}         Opt. Comma-separated Labels for fields to allow filtering on
    @api in_selectionMin;           // {Integer}        Opt. attribute to require a minimum number of records in selection
    @api in_selectionMax;           // {Integer}        0,1,2 to indicate whether the user should be able to select any record, or multiple
    @api in_initialNumRecords = 20; // {Integer}        Number of records which should initially be loaded, or appended via infinite loading
    @api in_tableHeight = '400px';  // {String}         Height of table to ensure lazy-loading, can be based on px (default) or relative (rem, em)

    // Output attributes
    @api selectedRecordList = [];   // {List<SObject>}  List of records which are selected and should be returned to the Flow
    @api selectedRecord;            // {SObject}        Single record which was selected when in_selectionMax == 1; to prevent requiring a Loop in Flow to gather the one record
    @api filter;                    // {String}         Filter-input by end-user to search; input/output to allow prefilled filter and prev/next processing

    // Utility attributes
    records = [];                   // {List<SObject>}  Current 'filtered'/applicable records (by filter applied, or full list)
    paginatedRecords = [];          // {List<SObject>}  Current records which should be shown - either a subset by 'pagination' or by filter value (this.records)
    @track shownRecords = [];       // {List<SObject>}  Effectively shown records - combination of paginatedRecords + selectedRecordList
    selectedIds = [];               // {List<Id>}       Allows more efficient removal from shownRecords when selected records are prepended to prevent duplicates

    numRecordsTotal = 0;            // {Integer}        Total number of records currently valid (either full this.in_records, or this.records)
    columns = [];                   // {List<Object>}   List of data-table-Column-objects to display; comma-separated from in_displayFieldsString
    fieldsToFilter;                 // {List<String>}   List of API names to filter on; comma-separated from in_filterFieldsString
    moreRecordsAvailable = false;   // {Boolean}        Indicating whether records.length > numRecordsTotal and with that enforce enable-infinite-loading
    optionSelect_None = false;      // {Boolean}        Whether or not selectionType == 0; used for conditional display
    tableDiv_Styles;                // {String}         Textual concatenation of table height to ensure table only takes a certain height and allow lazy loading (else all is shown)

    /**
     * Method to construct the Label above the filter when necessary
     * If the current list of records is set, show only the length when no selection is allowed, or the num selected per total record set
     * When the current list is not yet set/constructed, only show the text Filter
     */
    get filterLabel(){
        if( this.records ){
            return ( this.optionSelect_None )
                ? LABEL_FILTER + ' (' + this.records.length + ')'
                : LABEL_FILTER + ' (' + this.selectedIds.length + '/' + this.records.length + ')';
        } else{
            return LABEL_FILTER;
        }
    }

    @api
    validate() {
        if( this.in_selectionMin && this.selectedIds.length < this.in_selectionMin ) {
            return {
                isValid: false,
                errorMessage: LABEL_REQUIRED_MESSAGE?.replace( '{0}', this.in_selectionMin )
            };
        }
        return { isValid: true };
    }

    connectedCallback(){
        // Set the Boolean whether records should be possible to be selected, or not
        this.optionSelect_None = ( this.in_selectionMax == 0 );
        this.tableDiv_Styles = 'height:' + this.in_tableHeight + ';';

        // Convert display fields (and opt. labels) to columns which are used by Lightning DataTable
        let displayFields = this.in_displayFieldsString.replace( / /g, '' ).split( ',' );
        let displayLabels = this.in_displayLabelsString?.split( ',' );
        let showLabelsInsteadOfFieldAPI = ( displayLabels != null && displayLabels.length == displayFields.length );
        displayFields.forEach( ( fieldAPIName, i ) => {
            let columnLabel = ( showLabelsInsteadOfFieldAPI ) ? displayLabels[ i ].trim() : fieldAPIName;
            this.columns.push( { label: columnLabel, fieldName: fieldAPIName, type: String, sortable: true } );
        } );

        // Convert fields to filter to a List to allow looping
        if( !this.isBlank( this.in_filterFieldsString ) ){
            this.fieldsToFilter = this.in_filterFieldsString.replace( / /g, '' ).split( ',' );
            // When labels are provided to overrule the API Field values displayed in the filter-input placeholder,
            // validate whether number of fields matches for filter API vs. filter Labels to prevent undesired situations, else reset
            if( this.isBlank( this.in_filterLabelsString ) || this.in_filterLabelsString.split( ',' ).length != this.fieldsToFilter.length ){
                this.in_filterLabelsString = this.in_filterFieldsString;
            }
        }

        // Verify whether by input some records should be pre-selected, and fake as if the user performs the selection
        // By this, we ensure the selectedIds list (only containing the IDs) is also properly set using centralized code
        if( this.selectedRecordList && this.selectedRecordList.length > 0 ){
            this.handleSelection( { detail: { selectedRows: this.selectedRecordList } } );
        } else if( this.in_selectionMax == 1 && this.selectedRecord ){
            this.handleSelection( { detail: { selectedRows: [ this.selectedRecord ] } } );
        }

        // Assign initial set of records to show, either filter by provided prefilled filter, or display full list
        if( !this.isBlank( this.filter ) ){
            this.filterRecords( { detail: { value: this.filter } } );
        } else{
            this.displayNewFilteredRecords( this.in_records );
        }
    }

    /**
     * Method allowing to correctly set the initial number of records, being restricted by the initialNumRecords
     * This method can be called in two places:
     * 1) from connectedCallback (with the full this.records set)
     * 2) from filterRecords (after a new filter was applied, or reset)
     */
    displayNewFilteredRecords( newRecords ){
        this.records = newRecords;
        this.numRecordsTotal = newRecords?.length || 0;

        // If number of records is higher than we initially want to load, only show the first in_initialNumRecords and set table to load more
        this.moreRecordsAvailable = ( this.numRecordsTotal > this.in_initialNumRecords );
        this.setPaginatedRecords_prefixSelectedRecords( ( this.moreRecordsAvailable )
            ? newRecords.slice( 0, this.in_initialNumRecords )
            : newRecords
        );
    }

    /**
     * To prevent selected records to become 'out of scope' due to filtering (and be deselected by default data-table behaviour)
     * and for better user-experience, selectedRecords should be listed on top.
     *
     * This method is to ensure the table always first shows the selected records and only after the available/paginated records (excl. duplicate records).
     * This logic is isolated from displayNewFilteredRecords() to allow calling it from loadMoreData().
     */
    setPaginatedRecords_prefixSelectedRecords( newRecordsToShow ){
        this.paginatedRecords = newRecordsToShow;
        if( newRecordsToShow?.length > 0 ){
            this.shownRecords = this.selectedRecordList.concat(
                newRecordsToShow.filter( ( elem ) => {
                    return !this.selectedIds.includes( elem.Id );
                }
            ) );
        } else{
            this.shownRecords = [];
        }
    }

    loadMoreData( evt ){
        // Display a spinner to signal that data is being loaded
        evt.target.isLoading = true;

        // Enrich current shownRecords list with either an additional +in_initialNumRecords OR with the last remaining
        let currNumRecordsShown = this.paginatedRecords.length;
        if( currNumRecordsShown + this.in_initialNumRecords < this.numRecordsTotal ){
            this.setPaginatedRecords_prefixSelectedRecords( this.paginatedRecords.concat( this.records.slice( currNumRecordsShown, currNumRecordsShown + this.in_initialNumRecords ) ) );
            this.moreRecordsAvailable = true;
        } else{
            this.setPaginatedRecords_prefixSelectedRecords( this.records );
            this.moreRecordsAvailable = false;
        }
        evt.target.isLoading = false;
    }

    filterRecords( evt ){
        this.filter = evt.detail.value;
        // When filter was 'cleared', reset the filteredRecords and display the full set
        if( this.isBlank( this.filter ) ){
            this.records = this.in_records;
        } else{
            // Else, apply the filter on the total records list, after constructing the filter-object having the new requested string for each requested field;
            let filtersObj = {};
            this.fieldsToFilter.forEach( ( field ) => {
                filtersObj[ field ] = this.filter.toLowerCase();
            } );
            this.records = this.filterByKeyValueObject( this.in_records, filtersObj );
        }

        this.displayNewFilteredRecords( this.records );
    }

    handleSelection( evt ){
        this.selectedRecordList = evt.detail.selectedRows;
        this.selectedIds = this.selectedRecordList.map( r => r.Id );
        if( this.in_selectionMax == 1 ){
            this.selectedRecord = ( this.selectedRecordList.length > 0 ) ? this.selectedRecordList[ 0 ] : null;
        }
    }

    /**
     * Utility methods - normally in separate service-Component - but extracted to allow independent distribution
     */
    /**
     *  @param textValue    (String)    Text to be validated whether it is empty
     *  @return (String)                Boolean whether or not provided string is empty
     */
    isBlank( textValue ){
        return ( !textValue || textValue.length == 0 );
    }

    /**
     * Auxiliary function that receives an array and an object containing key/value filters. This method will retrieve all
     * objects that match any specified key/value pairs in the object
     *
     * @param {Array}   arr         Array of objects
     * @param {Object}  filters     Object containing filter elements
     */
    filterByKeyValueObject( arr, filters ){
        return arr.filter( elem => {
            // Check if filter array contains property and if the element's value contains the filter value
            for( let key in filters ){
                if( filters.hasOwnProperty( key ) && elem[ key ] && elem[ key ].toLowerCase().includes( filters[ key ] ) ){
                    return true;
                }
            }
            return false;
        } );
    }
}