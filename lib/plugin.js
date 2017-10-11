Object.defineProperty(exports, "__esModule", {value: true});

require('backgrid/lib/backgrid.min.css');
require('font-awesome/css/font-awesome.css');

var _ = require('lodash');
var $ = jQuery = require('jquery');
var Backbone = require('Backbone');
var Backgrid = require('Backgrid');
var key = require('keyboard-shortcut');
var MqttClient = require('@mqttclient/web');
var yo = require('yo-yo');
var {Menu, Panel, Widget} = require('@phosphor/widgets');
var {ILayoutRestorer, JupyterLab} = require('@jupyterlab/application');
var {InstanceTracker, IMainMenu, Toolbar, ToolbarButton} = require('@jupyterlab/apputils');
var {ILauncher} = require('@jupyterlab/launcher');
var {IDisposable, DisposableDelegate} = require('@phosphor/disposable');

const NAMESPACE = "microdrop-step-protocol";

const COMMANDIDs = {
  open: `${NAMESPACE}:open`
};

class StepProtocol extends MqttClient {
  constructor(panel, tracker){
    super();
    this.panel = panel;
    this.toolbar = new Toolbar();
    this.content = new Widget();
    this.panel.addWidget(this.toolbar);
    this.panel.addWidget(this.content);
    this.tracker = tracker;
    this.model = new Backbone.Model();
    this.renderToolbar();
    // Overrides:
    Backgrid.NumberCell = this._NumberCell();
  }

  listen() {
    if (!document.contains(this.panel.node)) {this.dispose()}
    this.onStateMsg("protocol-model", "protocol-skeletons", this.onProtocolSkeletonsSet.bind(this));
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
    key("delete", this.onDelete.bind(this));
    key('right', this.onNext.bind(this));
    key('left', this.onPrev.bind(this));
  }

  get ready() {
    // Check if all expected model attributes have been set
    if (!this.model.has("schema")) return false;
    if (!this.model.has("steps")) return false;
    if (!this.model.has("stepNumber")) return false;
    return true;
  }

  dispose() {
    /* Remove old panels not visible in ui */
    this.panel.dispose();
    this.client.disconnect();
    delete this;
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

  onProtocolSkeletonsSet(payload) {
    const data = JSON.parse(payload);
    this.model.set("protocolNames", _.map(data, "name"));
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

    // Clear the old ui
    this.content.node.innerHTML = "";

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

  _NumberCell() {
    const _this = this;
    return Backgrid.NumberCell.extend({
      enterEditMode: function(...args) {
        console.log("entering edit mode", this.model, args);
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
      columns[k] = column;
    }
    if (columns["step"]) {columns["step"].editable = false;}
    return _.values(columns);
  }

};

function createMenu(app) {
  let commands = app.commands;
  let menu = new Menu({ commands: commands });
  menu.title.label = "Microdrop";
  menu.addItem({ command: COMMANDIDs.open})
  menu.addItem({ type: 'separator' });
  return menu;
}

exports.default = [{
  id: NAMESPACE,
  autoStart: true,
  requires: [ILauncher, ILayoutRestorer, IMainMenu],
  activate: function(app, launcher, restorer, mainMenu) {

    const tracker = new InstanceTracker({ namespace: NAMESPACE });
    const manager = app.serviceManager;

    const launch = (id=null, name='Step Protocol') => {
      const panel = new Panel();
      if (!id) id = `${Date.now()}:${Math.random()*1000}`;
      panel.id = id;
      panel.pluginName = name;
      panel.title.label = name;
      panel.title.closable = true;
      tracker.add(panel);
      app.shell.addToMainArea(panel);
      app.shell.activateById(panel.id);
      panel.interface = new StepProtocol(panel);
      return panel;
    };

    const callback = () => {
      return manager.ready.then( () => {
        return launch();
      });
    };

    app.commands.addCommand(COMMANDIDs.open, {
      label: "New Protocol",
      execute: (args) => {
        return manager.ready.then( () => {
          return launch(args.id, args.url, args.pluginName);
        });
      }
    });

    restorer.restore(tracker, {
      command: COMMANDIDs.open,
      args: (p) =>  {
        return {id: p.id, url: p.url, pluginName: p.pluginName}
      },
      name: (p) => {
        return p.id;
      }
    });

    // Create MainMenu Item:
    const menu = createMenu(app);
    mainMenu.addMenu(menu);

    // Add to launcher
    launcher.add({
      displayName: "New Protocol",
      category: "Microdrop",
      rank: 0,
      callback: callback
    });
  }
}];
