#include <amxmodx>
#include <cstrike>
#include <fun>

#define PLUGIN "VipSystem"
#define VERSION "1.2"
#define AUTHOR "TRS"

new const TAG[] = "[TRS]";

public plugin_init() {
    register_plugin(PLUGIN, VERSION, AUTHOR);
    register_clcmd("say /vip", "cmdVip");
}

public cmdVip(id) {
    new name[32];
    get_user_name(id, name, charsmax(name));
    client_print(id, print_chat, "%s Ola %s, voce e VIP!", TAG, name);
    client_print(0, print_chat, "%s Vip ativou no servidor", TAG);
    return PLUGIN_HANDLED;
}