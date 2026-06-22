sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "zpp261e/model/models",
    "sap/ui/model/Filter",           // <-- Add this
    "sap/ui/model/FilterOperator",   // <-- Add this
    "sap/m/MessageToast",            // <-- Add this
    "sap/m/MessageBox"               // <-- Add this
], function (Controller, models, Filter, FilterOperator, MessageToast, MessageBox) { 
    // ^ Changed to standard 'function' and added corresponding parameters
    "use strict";

    return Controller.extend("zpp261e.controller.View1", {
         onInit: function () {
            var oLocalModel = models.createLocalModel();
            this.getView().setModel(oLocalModel, "local");
        },

        // Triggered when Production Order is entered/changed
        onProdOrderChange: function () {
            var oView = this.getView();
            var oLocalModel = oView.getModel("local");
            var sProdOrder = oLocalModel.getProperty("/selection/prodOrder");

            if (!sProdOrder) {
                return;
            }

            // Pad the production order to 12 characters as SAP expects it
            var sFormattedProdOrder = sProdOrder.padStart(12, "0");
            
            // Re-update the formatted value back to the model
            oLocalModel.setProperty("/selection/prodOrder", sFormattedProdOrder);

            this.fetchHeaderDataByProdOrder(sFormattedProdOrder);
        },

        fetchHeaderDataByProdOrder: function (sProdOrder) {
            var oView = this.getView();
            var oModel = oView.getModel(); // Main OData V4 model
            var oLocalModel = oView.getModel("local");

            // Filter strictly by Manufacturing Order
            var aFilters = [
                new Filter("ManufacturingOrder", FilterOperator.EQ, sProdOrder)
            ];

            var oListBinding = oModel.bindList("/ZI_GET_HEADER", null, null, aFilters, {
                $select: "ManufacturingOrder,SalesOrder,SalesOrderItem,MfgOrderPlannedTotalQty,ProductionUnit,ProductionPlant"
            });

            oView.setBusy(true);
            oListBinding.requestContexts(0, 1).then(function (aContexts) {
                oView.setBusy(false);
                if (aContexts.length === 0) {
                    MessageToast.show("No header details found for this Production Order.");
                    return;
                }

                var oHeader = aContexts[0].getObject();
                
                // Populate Local Model with header details
                oLocalModel.setProperty("/selection/salesOrder", oHeader.SalesOrder);
                oLocalModel.setProperty("/selection/salesOrderItem", oHeader.SalesOrderItem);
                oLocalModel.setProperty("/selection/prodOrdQty", oHeader.MfgOrderPlannedTotalQty);
                oLocalModel.setProperty("/selection/plant", oHeader.ProductionPlant);
                oLocalModel.setProperty("/selection/unit", oHeader.ProductionUnit);

                // Make sure fetchBatchesInBackground is defined elsewhere in your controller!
                if(this._fetchBatchesInBackground) {
                    this._fetchBatchesInBackground(oHeader.SalesOrder, oHeader.SalesOrderItem);
                }
                
            }.bind(this)).catch(function (oError) {
                oView.setBusy(false);
                MessageBox.error("Error fetching header details.");
            });
        },


        onSlocChange: function () {
            var oLocalModel = this.getView().getModel("local");
            var sSalesOrder = oLocalModel.getProperty("/selection/salesOrder");
            var sSalesOrderItem = oLocalModel.getProperty("/selection/salesOrderItem");

            // Only try to re-fetch if the Sales Order details are already known
            if (sSalesOrder && sSalesOrderItem) {
                this._fetchBatchesInBackground(sSalesOrder, sSalesOrderItem);
            }
        },
         
       // ==========================================
        // BACKGROUND CACHE LOGIC
        // ==========================================
        _fetchBatchesInBackground: function (sSalesOrder, sSalesOrderItem) {
            var oView = this.getView();

            var sSloc = oLocalModel.getProperty("/selection/Sloc");

            // 2. Validation: Give error message if Storage Location is empty
            if (!sSloc || sSloc.trim() === "") {
                sap.m.MessageBox.error("Please enter a Storage Location to load the batches.");
                return; 
            }

            console.log("Attempting fetch... Sales Order:", sSalesOrder, " | Item:", sSalesOrderItem , " | Storage Location:", sSloc);

            if (!sSalesOrder || !sSalesOrderItem) {
                return; 
            }

            var oModel = oView.getModel(); // Your OData V4 Model
            
            // FIX: Match the CDS View field names exactly (SDDocument instead of SalesOrder)
            var aFilters = [
                new Filter("SDDocument", FilterOperator.EQ, sSalesOrder),
                new Filter("SDDocumentItem", FilterOperator.EQ, sSalesOrderItem),
                new Filter("StorageLocation", FilterOperator.EQ, sSloc) // Filter by Storage Location as well
            ];

            // FIX: Update the $select string to match CDS View and remove extra spaces
            var mParameters = {
                "$select": "Batch,Plant,StorageLocation,Material,ProductDescription,SDDocument,SDDocumentItem,QTY,MaterialBaseUnit"
            };

            var oListBinding = oModel.bindList("/ZI_GET_BATCH", null, null, aFilters, mParameters);
            
            console.log("Sending network request to SAP...");

            oListBinding.requestContexts(0, 5000).then(function (aContexts) {
                var aAllBatches = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });
                
                console.log("Data successfully downloaded:", aAllBatches);
                oView.getModel("local").setProperty("/allBatches", aAllBatches);

                sap.m.MessageToast.show("Scanner Ready: Loaded " + aAllBatches.length + " batches.");
                
            }).catch(function(oError) {
                console.error("Fetch batches failed:", oError);
                sap.m.MessageToast.show("Failed to load background batches: " + oError.message);
            });
        },

        // ==========================================
        // SCAN VALIDATION & APPEND LOGIC
        // ==========================================
        onAddBatch: function (oEvent) {
            var oView = this.getView();
            var oInput = oView.byId("batchInput");
            
            var sScannedBatch = oInput.getValue().trim(); 
            var oLocalModel = oView.getModel("local");

            // Helper function to keep focus on the scanner input
            var retainFocus = function() {
                setTimeout(function() {
                    oInput.focus();
                }, 100);
            };

            if (!sScannedBatch) {
                sap.m.MessageToast.show("Please enter or scan a batch.");
                return;
            }

            var aAllBatches = oLocalModel.getProperty("/allBatches") || [];
            var aScanned = oLocalModel.getProperty("/scannedBatches") || [];

            var oFoundBatch = aAllBatches.find(function(b) {
                return b.Batch === sScannedBatch;
            });

            if (!oFoundBatch) {
                sap.m.MessageBox.error("Batch " + sScannedBatch + " not found or has 0 quantity in this Plant/SLoc.");
                oInput.setValue(""); 
                return;
            }

            var bAlreadyScanned = aScanned.some(function(b) {
                return b.batch === sScannedBatch;
            });

            if (bAlreadyScanned) {
                sap.m.MessageToast.show("Batch " + sScannedBatch + " is already added.");
                oInput.setValue("");
                return;
            }

            aScanned.push({
                batch:       oFoundBatch.Batch,
                material:    oFoundBatch.Material,
                description: oFoundBatch.ProductDescription,
                qty:         oFoundBatch.QTY,
                uom:         oFoundBatch.MaterialBaseUnit
            });

            oLocalModel.setProperty("/scannedBatches", aScanned);
            oInput.setValue("");

            this._calculateTotalYield();

            // 3. Keep the cursor locked in the box so the user can scan the next item instantly!
            retainFocus();
        },

        // ==========================================
        // DELETE SELECTED BATCHES
        // ==========================================
        onDeleteBatch: function (oEvent) {
            var oView = this.getView();
            var oTable = oView.byId("batchesTable");
            var oLocalModel = oView.getModel("local");

            
            var aSelectedContexts = oTable.getSelectedContexts();

            
            if (aSelectedContexts.length === 0) {
                sap.m.MessageToast.show("Please select at least one batch to delete.");
                return;
            }

           
            var aScannedBatches = oLocalModel.getProperty("/scannedBatches") || [];

            
            var aSelectedObjects = aSelectedContexts.map(function (oContext) {
                return oContext.getObject();
            });

            // remainingBatches will contain only those batches that were NOT selected for deletion
            var aRemainingBatches = aScannedBatches.filter(function (oBatch) {
                return aSelectedObjects.indexOf(oBatch) === -1;
            });

            // 6. Push the new, smaller array back to the model
            oLocalModel.setProperty("/scannedBatches", aRemainingBatches);

            // 7. Clear the checkboxes so they don't stay ghost-selected
            oTable.removeSelections(true);

            this._calculateTotalYield();
            sap.m.MessageToast.show(aSelectedContexts.length + " batch(es) deleted.");
        },

        // ==========================================
        // YIELD QUANTITY CALCULATION
        // ==========================================
        _calculateTotalYield: function () {
            var oLocalModel = this.getView().getModel("local");
            var aScannedBatches = oLocalModel.getProperty("/scannedBatches") || [];
            var fTotalQty = 0;

            // Loop through all scanned batches and sum the quantity
            aScannedBatches.forEach(function (oBatch) {
                // Parse float to ensure mathematical addition, not string concatenation
                fTotalQty += parseFloat(oBatch.qty) || 0; 
            });

            // Set the total back to the model, rounded to 2 decimal places (optional)
            oLocalModel.setProperty("/selection/yieldQty", fTotalQty.toFixed(3));
        },

        // ==========================================
        // SUBMIT TO BACKEND (DEEP INSERT)
        // ==========================================
        onSubmit: function () {
            var oView = this.getView();
            var oLocalModel = oView.getModel("local");
            var oODataModel = oView.getModel(); // Your primary OData V4 Model

            // 1. Get Data from Local Model
            var oSelection = oLocalModel.getProperty("/selection");
            var aScannedBatches = oLocalModel.getProperty("/scannedBatches") || [];

            // ==========================================
            // 2. VALIDATION
            // ==========================================
            if (!oSelection.prodOrder || !oSelection.operation || !oSelection.plant) {
                sap.m.MessageBox.error("Please fill in all mandatory Production Details.");
                return;
            }

            if (aScannedBatches.length === 0) {
                sap.m.MessageBox.error("Please scan at least one batch before submitting.");
                return;
            }

            // ==========================================
            // 3. FORMATTING THE PAYLOAD
            // ==========================================
            
            // Format Posting Date to "YYYY-MM-DD"
         var oDateFormat = sap.ui.core.format.DateFormat.getDateInstance({ pattern: "yyyy-MM-dd" });
            var sFormattedDate = oDateFormat.format(oSelection.postingDate);

            // Apply SAP Standard Alpha Conversion (Leading Zeros)
            var sProdOrder = (oSelection.prodOrder || "").trim().padStart(12, "0");
            var sOperation = (oSelection.operation || "").trim().padStart(4, "0");
            var sSalesOrder = (oSelection.salesOrder || "").trim().padStart(10, "0");
            var sSalesOrderItem = (oSelection.salesOrderItem || "").trim().padStart(6, "0");

            // Map the scanned batches array to the exact backend _Item structure
            var aItemsPayload = aScannedBatches.map(function(oBatch) {
                return {
                    "Batch": (oBatch.batch || "").trim().padStart(10, "0"), // Batches are usually 10 chars!
                    "Material": oBatch.material,
                    "MatDes": oBatch.description,
                    "Qty": String(oBatch.qty) || 0, 
                    "Unit": oBatch.uom
                };
            });

            // Construct the final Header payload
            var oPayload = {
                "ProdOrder": sProdOrder,           // <-- Now 12 chars
                "Operation": sOperation,           // <-- Now 4 chars
                "Salesorder": sSalesOrder,         // <-- Now 10 chars
                "Salesorderitem": sSalesOrderItem, // <-- Now 6 chars
                "Plant": oSelection.plant,
                "Unit": oSelection.unit,
                "ProdOrdQty": String(oSelection.prodOrdQty) || 0,
                "YieldQty": String(oSelection.yieldQty) || 0,
                "PostingDate": sFormattedDate, 
                "Shift": oSelection.shift,
                "StorlocFrom": oSelection.Sloc,
                "Remark": oSelection.remark || "",
                "_Item": aItemsPayload
            };

            // ==========================================
            // 4. ODATA V4 POST REQUEST
            // ==========================================
            
            oView.setBusy(true);

            // Bind to the target entity set
            var oListBinding = oODataModel.bindList("/ZC_261E_HD");

            // Execute the deep insert
            var oContext = oListBinding.create(oPayload);

            oContext.created().then(function () {
                oView.setBusy(false);
                
                // 1. Extract the returned properties from the backend response
                var sStatus = oContext.getProperty("Status");
                var sMessage = oContext.getProperty("Mess");
                var sConfGroup = oContext.getProperty("ConfirmationGroup");
                var sConfCount = oContext.getProperty("ConfirmationCount");

                // 2. Evaluate if the creation was truly successful
                if (sConfGroup && sStatus !== "E") {
                    
                    var sSuccessMsg = "Data posted successfully!\n\n" + 
                                      "Confirmation Group: " + sConfGroup + "\n" +
                                      "Confirmation Count: " + sConfCount;

                    sap.m.MessageBox.success(sSuccessMsg, {
                        onClose: function() {
                            // Automatically clear the screen after success
                            oLocalModel.setProperty("/scannedBatches", []);
                            oLocalModel.setProperty("/selection/prodOrder", "");
                            oLocalModel.setProperty("/selection/plant", "");
                            oLocalModel.setProperty("/selection/Sloc", "1210");
                            oLocalModel.setProperty("/selection/operation", "0010");
                            oLocalModel.setProperty("/selection/salesOrder", "");
                            oLocalModel.setProperty("/selection/salesOrderItem", "");
                            oLocalModel.setProperty("/selection/remark", "");
                            oLocalModel.setProperty("/selection/shift", "1");
                            oLocalModel.setProperty("/selection/yieldQty", "");
                            oLocalModel.setProperty("/selection/unit", "");
                            // Put cursor back at the production order input
                            var oProdOrderInput = oView.byId("inputProdOrder");
                            if (oProdOrderInput) {
                                oProdOrderInput.focus(); 
                            }
                        }
                    });
                } else {
                    // Backend accepted the call but business logic failed (e.g., missing group)
                    var sErrorText = sMessage ? sMessage : "Submission failed: Confirmation Group was not generated.";
                    sap.m.MessageBox.error(sErrorText);
                }

            }).catch(function (oError) {
                // Network or EDM parsing errors
                oView.setBusy(false);
                console.error("Submission Error:", oError);
                var sErrorMsg = oError.message ? oError.message : "Failed to post data to the backend.";
                sap.m.MessageBox.error("Submission failed: \n\n" + sErrorMsg);
            });
        },

        // ==========================================
        // CLEAR SCREEN FOR NEW ENTRY
        // ==========================================
        onNew: function () {
            var oView = this.getView();
            var oLocalModel = oView.getModel("local");

            // 1. Clear the scanned batches table
            oLocalModel.setProperty("/scannedBatches", []);

            // 2. Reset the Selection Screen fields to empty or defaults
            oLocalModel.setProperty("/selection/postingDate", new Date()); // Reset to today
            oLocalModel.setProperty("/selection/prodOrder", "");
            oLocalModel.setProperty("/selection/operation", "0010");
            oLocalModel.setProperty("/selection/salesOrder", "");
            oLocalModel.setProperty("/selection/salesOrderItem", "");
            oLocalModel.setProperty("/selection/prodOrdQty", "");
            oLocalModel.setProperty("/selection/unit", "");
            oLocalModel.setProperty("/selection/remark", "");
            
            // Retain defaults for standard fields to save user time (optional)
            oLocalModel.setProperty("/selection/plant", "");
            oLocalModel.setProperty("/selection/Sloc", "1210");
            oLocalModel.setProperty("/selection/shift", "1");

            // 3. Recalculate Yield (this will safely reset it to "0.00" since the array is now empty)
            if (this._calculateTotalYield) {
                this._calculateTotalYield();
            }

            // 4. Show a quick confirmation message
            sap.m.MessageToast.show("Screen cleared for a new entry.");

            // 5. UX Enhancement: Put the cursor back to the Production Order field 
            var oProdOrderInput = oView.byId("inputProdOrder");
            if (oProdOrderInput) {
                // Use a slight timeout to ensure the UI has finished rendering the reset state
                setTimeout(function() {
                    oProdOrderInput.focus();
                }, 100);
            }
        }
    });
});

