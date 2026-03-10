# tfWSPR

A experimental JavaScript implementation of the Weak Signal Propagation Reporter (WSPR) protocol.

## Overview
This project provides a native JavaScript implementation for encoding and decoding WSPR signals, offering a lightweight, browser-based alternative to traditional tools like `wsprd`.

## Webpages

### `receiver.html`
The receiver interface allows for real-time monitoring and decoding of WSPR signals. It processes incoming audio to detect and decode WSPR transmissions within a specified frequency range.
Link: https://fritzsche.github.io/tfWSPR/receiver.html


### `tx.html`
The transmitter interface provides tools for generating and sending WSPR transmissions.
Link: https://fritzsche.github.io/tfWSPR/tx.html

## Hardware Requirements
For optimal performance and reliable transmission/reception with the QMX transceiver:
- **IQ Mode:** The QMX must be configured to operate in IQ mode.
- **CAT Control:** The implementation relies on Computer Aided Transceiver (CAT) control to manage frequency and PTT (Push-to-Talk) functionality. Ensure your device is properly connected and configured for serial communication.

## Credits
This implementation is inspired by and references the logic found in the original `wsprd` codebase.
