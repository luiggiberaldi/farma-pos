import { X } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';
import { formatOfficialRate } from '../../utils/rateResolver';
import { mulR } from '../../utils/dinero';
import { useCheckoutPayments } from '../../hooks/useCheckoutPayments';
import CheckoutModePills from './CheckoutModePills';
import CheckoutCurrencySections from './CheckoutCurrencySections';
import CheckoutCasheaSection from './CheckoutCasheaSection';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import CheckoutCustomerPanel from './CheckoutCustomerPanel';
import CheckoutCtaBar from './CheckoutCtaBar';
import CheckoutFiarModal from './CheckoutFiarModal';
import CheckoutCustomerSheet from './CheckoutCustomerSheet';

export default function CheckoutModal({
    onClose,
    cartSubtotalUsd,
    cartSubtotalBs,
    cartTotalUsd,
    cartTotalBs,
    discountData,
    effectiveRate,
    customers,
    selectedCustomerId,
    setSelectedCustomerId,
    paymentMethods,
    onConfirmSale,
    isProcessingSale = false,
    requiresPrescription = false,
    triggerHaptic,
    onCreateCustomer,
    copEnabled,
    tasaCop,
    currentFloatUsd = 0,
    currentFloatBs = 0,
    useAutoRate = false
}) {
    useEscapeToClose(() => { if (!isProcessingSale) onClose(); });
    const p = useCheckoutPayments({
        cartTotalUsd, cartTotalBs, effectiveRate, customers,
        selectedCustomerId, setSelectedCustomerId, paymentMethods,
        onConfirmSale, requiresPrescription, triggerHaptic,
        onCreateCustomer, tasaCop, isProcessingSale,
    });

    return (
        <div role="dialog" aria-modal="true" aria-label="Cobro" className="fixed inset-0 z-50 bg-white dark:bg-slate-950 flex flex-col overflow-hidden">

        {/* --- HEADER --- */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <button type="button" aria-label="Cerrar cobro" disabled={isProcessingSale} onClick={onClose} className="p-3 -ml-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center">
        <X size={22} />
        </button>
        <div className="min-w-0">
        <h2 className="text-base font-black text-slate-800 dark:text-white tracking-wide font-sans leading-tight">PROCESAR PAGO</h2>
        <p className="text-[10px] font-bold text-slate-400 leading-tight">Tasa: {formatOfficialRate(effectiveRate)} Bs/$</p>
        </div>
        </div>
        <div className="shrink-0"><CheckoutModePills
                    payMode={p.payMode} setPayMode={p.setPayMode}
                    setCasheaActive={p.setCasheaActive} triggerHaptic={triggerHaptic}
                    selectedCustomerId={selectedCustomerId} setShowCustomerSheet={p.setShowCustomerSheet}
                /></div>
        <div className="hidden lg:block flex-1" />
        </div>


        {/* --- TOTAL BIMONEDA (FIJO) --- */}
        <div className="shrink-0 px-4 py-2.5 bg-gradient-to-b from-slate-50 to-slate-100/50 dark:from-slate-900 dark:to-slate-950/80 border-b border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center lg:hidden">
        {discountData?.active && (
        <div className="flex items-center gap-2 mb-1 text-xs">
        <span className="font-bold text-slate-400 dark:text-slate-500">Subtotal: ${cartSubtotalUsd.toFixed(2)} / Bs {formatBs(cartSubtotalBs)}</span>
        <span className="font-black text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded">
        Desc: -${discountData.amountUsd.toFixed(2)}
        </span>
        </div>
        )}
        <div className="flex items-baseline justify-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 self-center">
        {discountData?.active ? 'Total Final:' : 'Total a Pagar:'}
        </span>
        <span className={`text-3xl font-black ${discountData?.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
        ${cartTotalUsd.toFixed(2)}
        </span>
        <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-0.5 rounded-lg border border-emerald-100 dark:border-emerald-900/40">
        Bs {formatBs(cartTotalBs)}
        </span>
        {copEnabled && (
        <span className="text-xs font-extrabold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-0.5 rounded-lg border border-amber-100 dark:border-amber-900/40">
        COP {mulR(cartTotalUsd, tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </span>
        )}
        </div>
        </div>

            {/* --- SCROLLABLE BODY --- */}
            <div className="flex-1 overflow-y-auto overscroll-contain pb-8 lg:pb-4 lg:px-5">
                <div className="lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-5 lg:mx-auto lg:max-w-6xl">
                <div className="lg:min-w-0 lg:order-2">

                <CheckoutCurrencySections
                    methodsUsd={p.methodsUsd} methodsBs={p.methodsBs} methodsCop={p.methodsCop}
                    copEnabled={copEnabled} sectionStyles={p.sectionStyles}
                    USD_QUICK={p.USD_QUICK} BS_QUICK={p.BS_QUICK} addQuick={p.addQuick}
                    effectiveRate={effectiveRate} tasaCop={tasaCop}
                    barValues={p.barValues} handleBarChange={p.handleBarChange} fillBar={p.fillBar}
                />

                <CheckoutCasheaSection
                    casheaEnabled={p.casheaEnabled} useAutoRate={useAutoRate}
                    casheaMeetsMinimum={p.casheaMeetsMinimum} casheaMinAmount={p.casheaMinAmount}
                    selectedCustomer={p.selectedCustomer} casheaActive={p.casheaActive}
                    setCasheaActive={p.setCasheaActive} CASHEA_PERCENTS={p.CASHEA_PERCENTS}
                    casheaPercent={p.casheaPercent} setCasheaPercent={p.setCasheaPercent}
                    cartTotalUsd={cartTotalUsd} casheaAmountUsd={p.casheaAmountUsd}
                    effectiveRate={effectiveRate} triggerHaptic={triggerHaptic}
                />

                </div>

                <div className="lg:min-w-0 lg:order-1">
                {/* -- TOTAL PILL (SOLO PC) -- */}
                <div className="hidden lg:block px-3 pb-3">
                    <div className="rounded-2xl bg-slate-900 dark:bg-black px-5 py-4 shadow-lg">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            {discountData?.active ? 'Total Final' : 'Total a Pagar'}
                        </p>
                        <div className="flex items-baseline gap-2 mt-0.5">
                            <span className="text-3xl font-black text-white">${cartTotalUsd.toFixed(2)}</span>
                            <span className="text-sm font-extrabold text-emerald-400">Bs {formatBs(cartTotalBs)}</span>
                        </div>
                        {discountData?.active && (
                            <p className="text-[10px] font-bold text-amber-400 mt-1">
                                Subtotal ${cartSubtotalUsd.toFixed(2)} · Descuento -${discountData.amountUsd.toFixed(2)}
                            </p>
                        )}
                        {copEnabled && (
                            <p className="text-[10px] font-bold text-amber-400 mt-1">
                                COP {mulR(cartTotalUsd, tasaCop).toLocaleString('es-CO', { maximumFractionDigits: 0 })}
                            </p>
                        )}
                    </div>
                </div>

                <CheckoutCustomerPanel
                    selectedCustomer={p.selectedCustomer} setShowCustomerSheet={p.setShowCustomerSheet}
                    availableFavor={p.availableFavor} requiresPrescription={requiresPrescription}
                    prescription={p.prescription} setPrescription={p.setPrescription}
                    prescriptionReady={p.prescriptionReady}
                    totalPaidWithCasheaUsd={p.totalPaidWithCasheaUsd} isPaid={p.isPaid}
                    changeUsd={p.changeUsd} remainingUsd={p.remainingUsd}
                    changeBs={p.changeBs} remainingBs={p.remainingBs}
                    usableFavor={p.usableFavor} handleSaldoFavor={p.handleSaldoFavor}
                />
                </div>
                </div>
            </div>

            <CheckoutCtaBar
                isPaid={p.isPaid} changeBs={p.changeBs} changeUsd={p.changeUsd}
                remainingUsd={p.remainingUsd} remainingBs={p.remainingBs}
                copEnabled={copEnabled} tasaCop={tasaCop} effectiveRate={effectiveRate}
                changeCheck={p.changeCheck} changeUsdGiven={p.changeUsdGiven}
                changeBsGiven={p.changeBsGiven} selectChange={p.selectChange}
                currentFloatUsd={currentFloatUsd} currentFloatBs={currentFloatBs}
                isProcessingSale={isProcessingSale} prescriptionReady={p.prescriptionReady}
                casheaActive={p.casheaActive} casheaConfirmReady={p.casheaConfirmReady}
                selectedCustomerId={selectedCustomerId} payMode={p.payMode}
                triggerHaptic={triggerHaptic} handleConfirm={p.handleConfirm}
                setConfirmFiar={p.setConfirmFiar}
            />

            <CheckoutFiarModal
                confirmFiar={p.confirmFiar} setConfirmFiar={p.setConfirmFiar}
                casheaActive={p.casheaActive} casheaAmountUsd={p.casheaAmountUsd}
                remainingUsd={p.remainingUsd} remainingBs={p.remainingBs}
                effectiveRate={effectiveRate} selectedCustomer={p.selectedCustomer}
                totalPaidUsd={p.totalPaidUsd} handleConfirm={p.handleConfirm}
            />

            <CheckoutCustomerSheet
                showCustomerSheet={p.showCustomerSheet} closeCustomerSheet={p.closeCustomerSheet}
                showNewCustomerForm={p.showNewCustomerForm} setShowNewCustomerForm={p.setShowNewCustomerForm}
                customers={customers} customerSearch={p.customerSearch} setCustomerSearch={p.setCustomerSearch}
                filteredCustomers={p.filteredCustomers} selectedCustomerId={selectedCustomerId}
                handleSelectCustomer={p.handleSelectCustomer} setSelectedCustomerId={setSelectedCustomerId}
                setCasheaActive={p.setCasheaActive}
                newClientName={p.newClientName} setNewClientName={p.setNewClientName}
                newClientDocument={p.newClientDocument} setNewClientDocument={p.setNewClientDocument}
                newClientPhone={p.newClientPhone} setNewClientPhone={p.setNewClientPhone}
                savingClient={p.savingClient} handleCreateClient={p.handleCreateClient}
            />

        </div>
    );
}
