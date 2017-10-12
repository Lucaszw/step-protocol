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
  constructor(panel, tracker, protocolName=null){
    super();
    this.microdrop = new MicrodropAsync();
    this.panel = panel;
    this.panel.protocolName = protocolName;
    this.tracker = tracker;
    this.tracker.save(this.panel);
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
    this.onStateMsg("step-model", "steps", this.onStepsSet.bind(this));
    this.onStateMsg("step-model", "step-number", this.onStepNumberSet.bind(this));
    this.onStateMsg("schema-model", "schema", this.onSchemaSet.bind(this));
    this.bindPutMsg("step-model", "step-number", "put-step-number");
    this.bindTriggerMsg("step-model", "update-step", "update-step");
    this.bindTriggerMsg("step-model", "delete-step", "delete-step");
    this.bindTriggerMsg("step-model", "insert-step", "insert-step");
    this.on("next", this.onNext.bind(this));
    this.on("prev", this.onPrev.bind(this));
    this.model.on("change", this.render.bind(this));
    this.tracker._tracker.activeChanged.connect(this.activeChanged, this);
    key("delete", this.onDelete.bind(this));
    key('right', this.onNext.bind(this));
    key('left', this.onPrev.bind(this));
  }

  get active(){
      if (!this.tracker._tracker.currentWidget) return false;
      return this.protocolName == this.tracker._tracker.currentWidget.protocolName;
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
    this.tracker.save(this.panel);
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

  setupPanel() {
    this.panel.node.setAttribute("tabIndex", -1);
    this.panel.addWidget(this.toolbar);
    this.panel.addWidget(this.content);
    this.panel.onActivateRequest = (msg) => {this.panel.node.focus();}
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

  onNext() {
    if (!this.ready) return;
    const lastStep = this.model.get("steps").length - 1;
    const step = this.model.get("stepNumber");
    if (step == lastStep) this.trigger("insert-step", {stepNumber: lastStep});
    if (step != lastStep) this.trigger("put-step-number", {stepNumber: step+1});
  }
  onDelete() {
    if (!this.ready) return;
    this.trigger("delete-step", {stepNumber: this.model.get("stepNumber")});
  }

  onProtocolSkeletonSet(payload) {
    const data = JSON.parse(payload);
    const name = data.name;
    this.model.set("active-protocol", name);
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
    let next, prev;

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

    this.toolbar.insertItem(0, 'previous', prev);
    this.toolbar.insertItem(1, 'next', next);

  }
  render() {
    if (!this.ready) return;
    if (this.model.get("active-protocol") != this.protocolName) {
      console.log("not ready", this.model.get("active-protocol"), this.protocolName);
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

  NumberCell() {
    const _this = this;
    return Backgrid.NumberCell.extend({
      enterEditMode: function(...args) {
        const attributes = this.model.attributes;
        if (attributes.step != _this.model.get("stepNumber")){
          _this.trigger("put-step-number", {stepNumber: attributes.step});
          return;
        }
        this.constructor.__super__.enterEditMode.apply(this, ...args);
      }
    });
  }

  SchemaToBackgridColumns(schema) {
    const columns = new Object();
    for (const [k,v] of Object.entries(schema)) {
      if (!_.isPlainObject(v)) continue;
      const column = new Object();
      column.name = k;
      column.label = k;
      column.cell = v.type;
      if (v.type == "number") {column.cell = this.NumberCell();}
      columns[k] = column;
    }
    if (columns["step"]) {columns["step"].editable = false;}
    return _.values(columns);
  }

};

module.exports = StepProtocol;
