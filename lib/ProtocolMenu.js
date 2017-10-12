var {Menu} = require('@phosphor/widgets');
var MqttClient = require('@mqttclient/web');

const NAMESPACE = "microdrop-step-protocol";

class ProtocolMenu extends MqttClient {
  constructor(app, mainMenu, manager, launchFunction) {
    super();
    this.app = app;
    this.mainMenu = mainMenu;
    this.manager = manager;
    this.launchFunction = launchFunction;
    this.menu = null;
  }

  listen() {
    this.onStateMsg("protocol-model", "protocol-skeletons", this.onProtocolSkeletonsSet.bind(this));
  }

  onProtocolSkeletonsSet(payload) {
    const data = JSON.parse(payload);

    // Register commands:
    const commandIds = new Array();
    for (const [i, protocol] of data.entries()){
      const commandId = `${NAMESPACE}:${protocol.name}`;
      commandIds.push(commandId);
      if (this.app.commands.hasCommand(commandId)) continue;

      this.app.commands.addCommand(commandId, {
        label: protocol.name,
        execute: (args) => {
          return this.manager.ready.then( () => {
            return this.launchFunction(args.id, protocol.name);
          });
        }
      });
    }

    // Remove old menu
    if (this.menu) {
      this.mainMenu.removeMenu(this.menu);
      this.menu = undefined;
    }

    // Create new menu:
    this.menu = new Menu({ commands: this.app.commands });
    this.menu.title.label = "Microdrop Protocols";
    for (const [i, protocol] of data.entries()){
      this.menu.addItem({ command: commandIds[i]});
    }
    this.mainMenu.addMenu(this.menu);
  }
}

module.exports = ProtocolMenu;
