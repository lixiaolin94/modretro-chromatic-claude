#include <gb/cgb.h>
#include <gb/gb.h>
#include <gbdk/console.h>
#include <stdint.h>
#include <stdio.h>

static const palette_color_t background_palette[] = {
    RGB(31, 30, 25),
    RGB(17, 24, 19),
    RGB(8, 15, 15),
    RGB(3, 6, 8),
};

static const char *direction_for(uint8_t buttons) {
    if (buttons & J_UP) {
        return "UP   ";
    }
    if (buttons & J_DOWN) {
        return "DOWN ";
    }
    if (buttons & J_LEFT) {
        return "LEFT ";
    }
    if (buttons & J_RIGHT) {
        return "RIGHT";
    }
    if (buttons & J_A) {
        return "A    ";
    }
    if (buttons & J_B) {
        return "B    ";
    }
    if (buttons & J_START) {
        return "START";
    }
    if (buttons & J_SELECT) {
        return "SEL  ";
    }
    return "-----";
}

void main(void) {
    uint8_t previous_buttons = 0xFF;

    if (_cpu == CGB_TYPE) {
        set_bkg_palette(0, 1, background_palette);
    }

    printf("  MODRETRO CHROMATIC\n\n");
    printf("  REAL GBC ROM\n\n");
    printf("  PRESS A BUTTON\n\n");

    for (;;) {
        uint8_t buttons = joypad();

        if (buttons != previous_buttons) {
            gotoxy(2, 9);
            printf("INPUT: %s", direction_for(buttons));
            previous_buttons = buttons;
        }

        vsync();
    }
}
