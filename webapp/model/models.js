sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "sap/ui/Device"
], 
function (JSONModel, Device) {
    "use strict";

    return {
         /**
         * Provides runtime information for the device the UI5 app is running on as a JSONModel.
         * @returns {sap.ui.model.json.JSONModel} The device model.
         */
        createDeviceModel: function () {
            var oModel = new JSONModel(Device);
            oModel.setDefaultBindingMode("OneWay");
            return oModel;
        },

        /**
         * Main JSON model for the MIGO Batching selection and scanning screen.
         * Contains form inputs, background cache, and the active table array.
         */
        createLocalModel: function () {
            var oModel = new JSONModel({
                
                // 1. Selection Screen State
                selection: {
                    postingDate: new Date(), // Automatically sets today
                    prodOrder: "",
                    plant: "",
                    salesOrder: "",
                    salesOrderItem: "",
                    Sloc: "1210", 
                    shift : "1",
                    prodOrdQty: "",
                    operation : "0010",
                    unit : "",
                    remark: "",
                    yieldQty: ""
                },

                // 2. Background Data (Loaded from ZI_GET_BATCHES)
                allBatches: [],

                // 3. Active Table Data (Scanned items shown on UI)
                scannedBatches: []

            });

            // TwoWay binding allows the UI inputs to update this model instantly
            oModel.setDefaultBindingMode("TwoWay");
            
            return oModel;
        }
    };

});