require('bootstrap/dist/css/bootstrap.css');
require('font-awesome/css/font-awesome.css');

var _ = require('lodash');
var $ = require('jquery');
var MqttClient = require('@mqttclient/web');
var Mustache = require('mustache');
var {Panel} = require('@phosphor/widgets');
var {ILayoutRestorer, JupyterLab, JupyterLabPlugin} = require('@jupyterlab/application');
var {ICommandPalette, IMainMenu, IFrame, InstanceTracker} = require('@jupyterlab/apputils');
var {ILauncher} = require('@jupyterlab/launcher');
var {IStateDB} = require('@jupyterlab/coreutils');
var {JSONExt} = require('@phosphor/coreutils');

class UIPluginLauncher extends MqttClient {
  constructor(panel, tracker) {
    super("UIPluginLauncher");
    this.panel = panel;
    this.tracker = tracker;
    this.loaded = false;
    this.listen();
    if (this.panel.url)
      this.loadIframe(this.panel.url, this.panel.pluginName);
  }
  listen() {
    this.onStateMsg("web-server", "web-plugins", this.onWebPluginsChanged.bind(this));
    this.on("btn-clicked", this.onButtonClicked.bind(this));
    console.log("Listening for mqtt messages...");
  }
  loadIframe(url, name) {
    console.log("loading url...", url, name);
    const iframe = new IFrame();
    iframe.url = url;
    this.panel.node.innerHTML = "";
    this.panel.title.label = name;
    this.panel.addWidget(iframe);
    this.loaded = true;
  }
  onButtonClicked(data) {
    console.log(data);
    // TODO: Add subscription to get base microdrop url: (ex. localhost:3000)
    const url = `http://localhost:3000/${data.pluginView}`;
    this.panel.url = url;
    this.panel.pluginName = data.pluginName;
    this.tracker.save(this.panel);
    this.loadIframe(url, data.pluginName);
  }
  onWebPluginsChanged(payload) {
    if (this.loaded) return;

    const webPlugins = _.values(JSON.parse(payload));
    const views = new Array();
    for (const webPlugin of webPlugins)
      for (const view of webPlugin.data.views)
        views.push({name: webPlugin.data.name, view: view });

    this.render(views);
    const btns =
      this.panel.node.getElementsByClassName("microdrop-ui-plugin-btn");
    for (const btn of btns)
      btn.addEventListener("click", () => this.trigger("btn-clicked", btn.dataset));
  }
  render(data) {
    const output = Mustache.render(`
      <div class="container">
      {{#plugins}}
        <div class="row">
          <div class="col-md-4"><label class="mr-2">{{name}}</label></div>
          <div class="col-md-6">
            <input type="text" class="form-control form-control-sm mt-1" disabled value="{{view}}">
          </div>
          <div class="col-md-1">
            <button type="submit" class="btn btn-primary btn-sm mt-1 microdrop-ui-plugin-btn"
            data-plugin-name={{name}} data-plugin-view={{view}}>
              Launch
            </button>
          </div>
        </div>
      {{/plugins}}
      </div>
    `, {plugins: data});
    this.panel.node.innerHTML = output;
  }
}

module.exports = [{
  id: 'microdrop-ui-plugin',
  autoStart: true,
  requires: [ILauncher, ILayoutRestorer],
  activate: function(app, launcher, restorer) {
    const command = 'microdrop-ui-plugin:open';
    const tracker = new InstanceTracker({ namespace: 'microdrop-ui-plugin' });
    const manager = app.serviceManager;

    const launch = (id=null, url=null, name='UI Plugin Launcher') => {
      console.log("launching plugin: ", id, url, name);
      const panel = new Panel();
      if (!id) id = `${Date.now()}:${Math.random()*1000}`;
      panel.id = id;
      panel.url = url;
      panel.pluginName = name;
      panel.title.label = name;
      panel.title.closable = true;
      tracker.add(panel);
      app.shell.addToMainArea(panel);
      app.shell.activateById(panel.id);
      new UIPluginLauncher(panel, tracker);
      return panel;
    };

    const callback = () => {
      return manager.ready.then( () => {
        return launch();
      });
    };

    app.commands.addCommand(command, {
      label: "Load UI Plugin",
      execute: (args) => {
        return manager.ready.then( () => {
          return launch(args.id, args.url, args.pluginName);
        });
      }
    });

    restorer.restore(tracker, {
      command,
      args: (p) =>  {
        return {id: p.id, url: p.url, pluginName: p.pluginName}
      },
      name: (p) => {
        return p.id;
      }
    });

    launcher.add({
      displayName: "UI Plugin Launcher",
      category: "Microdrop",
      rank: 0,
      callback: callback
    });
  }
}];
