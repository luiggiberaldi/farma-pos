import SearchBar from './SearchBar';
import CategoryBar from './CategoryBar';

export default function SalesProductColumn(props) {
    const {
        searchInputRef, searchTerm, handleSetSearchTerm, handleSearchKeyDown,
        handlePasteBarcode, searchResults, selectedIndex, setSelectedIndex,
        effectiveRate, addToCart, isRecording, isProcessingAudio,
        startRecording, stopRecording, hierarchyPending, setHierarchyPending,
        weightPending, setWeightPending, showCheckout, showReceipt,
        selectedCategory, setSelectedCategory, filteredByCategory,
        triggerHaptic, setShowCustomAmountModal, products,
    } = props;
    return (
    <div className="flex-1 min-h-0 flex flex-col md:min-w-0 overflow-y-auto md:overflow-hidden" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Search + Popups */}
        <div className="shrink-0 mb-2 lg:mb-1.5 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-3 sm:p-4 lg:p-3 shadow-sm border border-slate-100 dark:border-slate-800">
            <SearchBar
                ref={searchInputRef}
                searchTerm={searchTerm}
                onSearchChange={handleSetSearchTerm}
                onKeyDown={handleSearchKeyDown}
                onPasteBarcode={handlePasteBarcode}
                searchResults={searchResults}
                selectedIndex={selectedIndex} setSelectedIndex={setSelectedIndex}
                effectiveRate={effectiveRate}
                addToCart={addToCart}
                isRecording={isRecording} isProcessingAudio={isProcessingAudio} startRecording={startRecording} stopRecording={stopRecording}
                hierarchyPending={hierarchyPending} setHierarchyPending={setHierarchyPending}
                weightPending={weightPending} setWeightPending={setWeightPending}
            />
        </div>

        {/* Category Chips + Product Grid */}
        {!showCheckout && !showReceipt && (
            <CategoryBar
                selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory}
                filteredByCategory={filteredByCategory}
                addToCart={addToCart}
                triggerHaptic={triggerHaptic}
                searchTerm={searchTerm}
                onOpenCustomAmount={() => setShowCustomAmountModal(true)}

        products={products}
    />
                    )}
                </div>
    );
}
