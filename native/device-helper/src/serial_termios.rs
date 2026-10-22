use libc::*;

// Darwin also defines DTR/DSR/DCD flow bits absent from libc's constants.
// Disable them so inherited flow control cannot drive DTR behind the owner's checked transitions.
#[cfg(target_os = "macos")]
const HARDWARE_FLOW: tcflag_t = CRTSCTS | 0x0004_0000 | 0x0008_0000 | 0x0010_0000;
#[cfg(target_os = "linux")]
const HARDWARE_FLOW: tcflag_t = CRTSCTS;
pub(crate) fn raw(mut value: termios) -> Result<termios, &'static str> {
    // SAFETY: value is an initialized termios; libc mutates only that struct.
    unsafe {
        cfmakeraw(&mut value);
    }
    value.c_cflag = (value.c_cflag & !(CSIZE | PARENB | PARODD | CSTOPB | HARDWARE_FLOW | HUPCL))
        | CS8
        | CLOCAL
        | CREAD;
    // Normalize Linux's separate input baud mask before choosing the standard capture rate.
    #[cfg(target_os = "linux")]
    {
        value.c_cflag &= !CIBAUD;
    }
    value.c_iflag &= !(IXON | IXOFF | IXANY);
    value.c_cc[VMIN] = 0;
    value.c_cc[VTIME] = 0;
    // SAFETY: initialized writable termios; standard B115200 is valid on both platforms.
    let speeds = unsafe {
        (
            cfsetispeed(&mut value, B115200),
            cfsetospeed(&mut value, B115200),
        )
    };
    if speeds != (0, 0) {
        return Err("io_failed");
    }

    Ok(value)
}
pub(crate) fn verified(value: &termios) -> bool {
    // SAFETY: value is initialized by tcgetattr or the pure builder.
    let speeds = unsafe { (cfgetispeed(value), cfgetospeed(value)) };
    speeds == (B115200, B115200)
        && value.c_cflag
            & (CSIZE | PARENB | PARODD | CSTOPB | HARDWARE_FLOW | HUPCL | CLOCAL | CREAD)
            == CS8 | CLOCAL | CREAD
        && value.c_iflag & (BRKINT | PARMRK | ISTRIP | INLCR | IGNCR | ICRNL | IXON | IXOFF | IXANY)
            == 0
        && value.c_oflag & OPOST == 0
        && value.c_lflag & (ECHO | ECHONL | ICANON | ISIG | IEXTEN) == 0
        && value.c_cc[VMIN] == 0
        && value.c_cc[VTIME] == 0
}
