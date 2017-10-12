Object.defineProperty(exports, "__esModule", {value: true});

var {Panel} = require('@phosphor/widgets');
var {ILayoutRestorer, JupyterLab} = require('@jupyterlab/application');
var {InstanceTracker, IMainMenu} = require('@jupyterlab/apputils');
var {ILauncher} = require('@jupyterlab/launcher');
var {IDisposable, DisposableDelegate} = require('@phosphor/disposable');

var StepProtocol = require('./StepProtocol');
var ProtocolMenu = require('./ProtocolMenu');

const NAMESPACE = "microdrop-step-protocol";
const COMMANDIDs = {
  open: `${NAMESPACE}:open`
};

exports.default = [{
  id: NAMESPACE,
  autoStart: true,
  requires: [ILauncher, ILayoutRestorer, IMainMenu],
  activate: function(app, launcher, restorer, mainMenu) {

    const tracker = new InstanceTracker({ namespace: NAMESPACE });

    const manager = app.serviceManager;

    const launch = (id=null, protocolName=null) => {
      const panel = new Panel();
      let pluginName;
      if (!id) id = `${Date.now()}:${Math.random()*1000}`;
      if (protocolName) pluginName = protocolName;
      if (!protocolName) pluginName = 'New Protocol';
      panel.id = id;
      panel.title.label = pluginName;
      panel.title.closable = true;
      tracker.add(panel);
      app.shell.addToMainArea(panel);
      app.shell.activateById(panel.id);
      panel.interface = new StepProtocol(panel, tracker, protocolName);
      return panel;
    };

    const callback = (cwd, name) => {
      const makeRequest = async () => {
        await manager.ready;
        await app.commands.execute('docmanager:new-untitled',
          {path: cwd, type: 'notebook'});
        return launch();
      };
      return makeRequest();
    };

    app.commands.addCommand(COMMANDIDs.open, {
      label: "New Protocol",
      execute: (args) => {
        return manager.ready.then( () => {
          return launch(args.id, args.protocolName);
        });
      }
    });

    restorer.restore(tracker, {
      command: COMMANDIDs.open,
      args: (p) =>  {
        return {id: p.id, protocolName: p.protocolName}
      },
      name: (p) => {
        return p.id;
      }
    });

    // Create MainMenu Item:
    const protocolMenu = new ProtocolMenu(app, mainMenu, manager, launch);

    // Add to launcher
    launcher.add({
      displayName: "New Protocol",
      category: "Microdrop",
      rank: 0,
      callback: callback
    });
  }
}];
