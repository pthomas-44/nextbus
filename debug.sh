#!/bin/bash

SHELL_DEBUG=all
#Used to spawn a nested gnome-shell for debugging purposes
dbus-run-session -- gnome-shell --nested --wayland