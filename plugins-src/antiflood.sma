#include <amxmodx>
#include <amxmisc>

#define PLUGIN "AntiFlood"
#define VERSION "1.0"
#define AUTHOR "Loja CS16 Plugins"

new g_iFlood[MAX_PLAYERS + 1];

public plugin_init() {
    register_plugin(PLUGIN, VERSION, AUTHOR);
    register_clcmd("say", "cmdSay");
}

public cmdSay(id) {
    // exemplo de anti-flood
    return PLUGIN_CONTINUE;
}