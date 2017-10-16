require('font-awesome/css/font-awesome.min.css');
require('backgrid/lib/backgrid.min.css');

var _ = require('lodash');
var $ = jQuery = require('jquery');
var Backbone = require('Backbone');
var Backgrid = require('Backgrid');
var key = require('keyboard-shortcut');

var {Widget} = require('@phosphor/widgets');
var {Toolbar, ToolbarButton} = require('@jupyterlab/apputils');

var MqttClient = require('@mqttclient/web');
var MicrodropAsync = require('@microdrop/async');

class StepProtocol extends MqttClient {
  constructor(panel, instanceTracker, focusTracker, protocolName=null){
    super();
    this.microdrop = new MicrodropAsync();
    this.panel = panel;
    this.panel.protocolName = protocolName;
    this.setupTrackers(instanceTracker, focusTracker);
    this.toolbar = new Toolbar();
    this.content = new Widget();
    this.model = new Backbone.Model();
    this.setupPanel();
    this.renderToolbar();
    this.loadProtocol();
  }

  listen() {
    if (!document.contains(this.panel.node)) {this.dispose()}
    this.onStateMsg("protocol-model", "protocol-skeleton", this.onProtocolSkeletonSet.bind(this));
    this.onStateMsg("device-model", "device", this.onDeviceSet.bind(this));
    this.onStateMsg("step-model", "steps", this.onStepsSet.bind(this));
    this.onStateMsg("step-model", "step-number", this.onStepNumberSet.bind(this));
    this.onStateMsg("schema-model", "schema", this.onSchemaSet.bind(this));
    this.bindPutMsg("step-model", "step-number", "put-step-number");
    this.bindTriggerMsg("step-model", "update-step", "update-step");
    this.bindTriggerMsg("step-model", "delete-step", "delete-step");
    this.bindTriggerMsg("step-model", "insert-step", "insert-step");
    this.on("next", this.onNext.bind(this));
    this.on("prev", this.onPrev.bind(this));
    this.on("save", this.onSave.bind(this));
    this.model.on("change", this.render.bind(this));
    this.focusTracker.activeChanged.connect(this.activeChanged, this);
    key("delete", this.onDelete.bind(this));
    key('down', this.onNext.bind(this));
    key('up', this.onPrev.bind(this));
  }

  get active(){
      if (!this.focusTracker.currentWidget) return false;
      return this.protocolName == this.focusTracker.currentWidget.protocolName;
  }

  get ready() {
    // Check if all expected model attributes have been set
    if (!this.model.has("schema")) return false;
    if (!this.model.has("steps")) return false;
    if (!this.model.has("stepNumber")) return false;
    return true;
  }

  get protocolName() {return this.panel.protocolName;}
  set protocolName(name) {
    this.panel.protocolName = name;
    this.saveInstance();
  }

  activeChanged() {
    if (!this.active) return;
    if (this.protocolName == this.model.get("active-protocol")) return;
    if (!this.protocolName) return;
    this.microdrop.protocol.changeProtocol(this.protocolName);
  }

  dispose() {
    /* Remove old panels not visible in ui */
    this.panel.dispose();
    this.client.disconnect();
    delete this;
  }

  loadProtocol() {
    const name = this.panel.protocolName;
    if (!name) {
      this.microdrop.protocol.newProtocol().then((d) => {
        const data = JSON.parse(d);
        this.protocolName = data.name;
      });
    } else {
      this.microdrop.protocol.changeProtocol(name);
    }
  }

  saveInstance() {
    if (this.instanceTracker)
      this.instanceTracker.save(this.panel);
  }

  save() {
    const save = async () => {
      const name = this.protocolName;
      const protocol = await this.microdrop.protocol.getProtocolByName(name);
      this.panel.file.model.value.text = JSON.stringify(protocol);
      this.panel.file.save();
    }
    return save();
  }

  setupTrackers(instanceTracker, focusTracker) {
    this.instanceTracker = instanceTracker;
    if (!focusTracker) this.focusTracker = this.instanceTracker._tracker;
    else this.focusTracker = focusTracker;
    this.saveInstance();
  }

  setupPanel() {
    this.panel.node.setAttribute("tabIndex", -1);
    this.content.node.style.overflowX = "scroll";
    this.content.node.style.zoom = 0.7;
    this.panel.node.style.outline = "0px";
    this.panel.addWidget(this.toolbar);
    this.panel.addWidget(this.content);
    this.panel.onActivateRequest = (msg) => {this.panel.node.focus();}
  }

  onDelete() {
    if (!this.ready) return;
    this.trigger("delete-step", {stepNumber: this.model.get("stepNumber")});
  }

  onDeviceSet(payload) {
    console.log("device set", payload);
  }

  onNext() {
    if (!this.ready) return;
    const lastStep = this.model.get("steps").length - 1;
    const step = this.model.get("stepNumber");
    if (step == lastStep) this.trigger("insert-step", {stepNumber: lastStep});
    if (step != lastStep) this.trigger("put-step-number", {stepNumber: step+1});
  }

  onPrev() {
    if (!this.ready) return;
    const step = this.model.get("stepNumber");
    const lastStep = this.model.get("steps").length - 1;
    let prev;
    if (step == 0) prev = lastStep;
    if (step != 0) prev = step-1;
    this.trigger("put-step-number", {stepNumber: prev});
  }

  onProtocolSkeletonSet(payload) {
    const data = JSON.parse(payload);
    const name = data.name;
    this.model.set("active-protocol", name);
  }

  onSave() {
    // Check if has a file:
    if (!this.panel.file) {
      console.error(`<StepProtocol>#onSave file does not exist`);
      return;
    }
    return this.save();
  }

  onSchemaSet(payload) {
    // stackoverflow : merging-objects-of-an-array-using-lodash
    const data = JSON.parse(payload);
    this.model.set("schema", _.assign(..._.values(data)));
  }

  onStepsSet(payload) {
    // stackoverflow : merging-objects-of-an-array-using-lodash
    const data = JSON.parse(payload);
    const steps = _.map(data, (o) => {return _.assign(..._.values(o))});
    this.model.set("steps", steps);
  }

  onStepNumberSet(payload) {
    const data = JSON.parse(payload);
    this.model.set("stepNumber", data.stepNumber);
  }

  renderToolbar() {
    this.toolbar.node.innerHTML = "";
    this.toolbar.node.style.height = "auto";
    let next, prev, save;

    prev = new ToolbarButton({
      className: "fa fa-arrow-left",
      tooltip: 'Previous',
      onClick: () => this.trigger("prev", null)});
    prev.node.style.height = "auto";

    next = new ToolbarButton({
      className: "fa fa-arrow-right",
      tooltip: 'Next',
      style: {height: "auto"},
      onClick: () => this.trigger("next", null)});
    next.node.style.height = "auto";

    save = new ToolbarButton({
      className: "jp-SaveIcon",
      tooltip: 'Save',
      style: {height: "auto"},
      onClick: () => this.trigger("save", null)});
    save.node.style.height = "auto";

    this.toolbar.insertItem(0, 'previous', prev);
    this.toolbar.insertItem(1, 'next', next);
    this.toolbar.insertItem(2, 'save', save);

  }
  render() {
    if (!this.ready) {
      console.warn("<StepProtocol#render>: not ready", this.model);
      return;
    }
    if (this.model.get("active-protocol") != this.protocolName) {
      // Disable inactive protocols
      this.content.node.style.opacity = "0.7";
      this.content.node.style.pointerEvents = "none";
      return;
    }

    // Clear the old ui
    this.content.node.innerHTML = "";
    this.content.node.style.opacity = "1";
    this.content.node.style.pointerEvents = "auto";

    // Create a Backbone collection to listen for changes in table
    const columns = this.SchemaToBackgridColumns(this.model.get("schema"));
    const collection = new Backbone.Collection();

    collection.add(this.model.get("steps"));

    collection.on("change", (model) => {
      const step = model.attributes.step;
      const k = _.keys(model.changed)[0];
      const v = _.values(model.changed)[0];
      const msg = {data: { key: k, val: v, stepNumber: step}};
      this.trigger("update-step", msg);
    });

    // Draw table using backgrid
    var grid = new Backgrid.Grid({
      columns: columns,
      collection: collection
    });
    this.content.node.appendChild(grid.render().el);

    // Highlight the current stepNumber:
    const row = grid.el.rows[this.model.get("stepNumber")+1];
    if (row)  {row.style.background = "rgb(233, 233, 233)";}
  }

  SelectableCell(constructor, editable=true) {
    const _this = this;
    const obj = {
      enterEditMode: function(...args) {
        const attributes = this.model.attributes;
        if (attributes.step != _this.model.get("stepNumber")){
          _this.trigger("put-step-number", {stepNumber: attributes.step});
          return;
        }
        if (editable == false) return;
        this.constructor.__super__.enterEditMode.apply(this, ...args);
      }
    };
    return constructor.extend(obj);
  }

  SchemaToBackgridColumns(schema) {
    let columns = new Object();

    // Return the proper cell constructor for each schema o
    const getCell = (v) => {
      if (!v.type) v.type = "string";
      var capitalized = v.type.charAt(0).toUpperCase() + v.type.slice(1);
      var cellType = `${capitalized}Cell`;
      return this.SelectableCell(Backgrid[cellType]);
    }

    // Create column object for each entry of schema
    for (const [k,v] of Object.entries(schema)) {
      if (!_.isPlainObject(v)) continue;
      // XXX: Temporarily overridiing number type (should change in schema)
      if (v.type == "number") v.type = "integer";
      const column = new Object();
      column.name = k;
      column.label = k;
      column.cell = getCell(v);
      columns[k] = column;
    }

    // Customize step column so that is is non-editable
    if (columns["step"]) {
      columns["step"].cell =
        this.SelectableCell(Backgrid["StringCell"], false);
    }

    return _.values(columns);
  }

};

module.exports = StepProtocol;
