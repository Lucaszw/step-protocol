Object.defineProperty(exports, "__esModule", {value: true});

var {Panel} = require('@phosphor/widgets');
var {ILayoutRestorer, JupyterLab} = require('@jupyterlab/application');
var {InstanceTracker, IMainMenu} = require('@jupyterlab/apputils');
var {ILauncher} = require('@jupyterlab/launcher');
var {IDisposable, DisposableDelegate} = require('@phosphor/disposable');
var {DocumentManager} = require('@jupyterlab/docmanager');

var MicrodropAsync = require('@microdrop/async');

var StepProtocol = require('./StepProtocol');
var ProtocolMenu = require('./ProtocolMenu');

const NAMESPACE = "microdrop-step-protocol";
const COMMANDIDs = {
  open: `${NAMESPACE}:open`
};

const microdrop = new MicrodropAsync();

exports.StepProtocol = StepProtocol;
exports.ProtocolMenu = ProtocolMenu;

exports.default = [{
  id: NAMESPACE,
  autoStart: true,
  requires: [ILauncher, ILayoutRestorer, IMainMenu],
  activate: function(app, launcher, restorer, mainMenu) {

    const manager = app.serviceManager;
    const registry = app.docRegistry;
    const tracker = new InstanceTracker({ namespace: NAMESPACE });

    // Launch function (called by all launch methods)
    const launch = (id=null, protocolName=null, file=null) => {
      const panel = new Panel()
      let pluginName;
      if (!id) id = `${Date.now()}:${Math.random()*1000}`;
      if (protocolName) pluginName = protocolName;
      if (!protocolName) pluginName = 'New Protocol';
      panel.id = id;
      panel.title.label = pluginName;
      panel.title.closable = true;
      panel.file = file;
      tracker.add(panel);
      app.shell.addToMainArea(panel);
      app.shell.activateById(panel.id);
      panel.interface = new StepProtocol(panel, tracker, undefined, protocolName);
      return panel;
    };

    // Create MainMenu Item:
    const protocolMenu = new ProtocolMenu(app, mainMenu, manager, launch);

    // Create Application command:
    app.commands.addCommand(COMMANDIDs.open, {
      label: "Step Protocol",
      execute: (args) => {
        return manager.ready.then( () => {
          return launch(args.id, args.protocolName);
        });
      }
    });

    // Handler layout restoration:
    restorer.restore(tracker, {
      command: COMMANDIDs.open,
      args: (p) =>  {
        return {id: p.id, protocolName: p.protocolName}
      },
      name: (p) => {
        return p.id;
      }
    });

    // Create launcher item:
    const launcherCallback = (cwd, name) => {

      return new Promise((resolve, reject) => {
        const docManager = new DocumentManager({ registry, manager, opener });

        const createFile = async () => {
          await manager.ready;
          const model = await app.commands.execute('docmanager:new-untitled',
            {path: cwd, type: 'file', ext: '.uprotocol'});
          return await app.commands.execute('docmanager:open', {path: model.path});
        }

        resolve(createFile());
      });

    };
    launcher.add({
      displayName: "New Protocol",
      category: "Microdrop",
      rank: 0,
      callback: launcherCallback
    });
  }
}];
