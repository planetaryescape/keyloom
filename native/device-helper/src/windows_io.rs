//! Owned handles and bounded overlapped I/O. No OVERLAPPED/buffer outlives its allocation.
use crate::{
    windows_contract::{Completion, PendingIo, complete},
    windows_registry::wide,
};
use std::ptr;
use windows_sys::Win32::{
    Foundation::*,
    Storage::FileSystem::*,
    System::{IO::*, Threading::*},
};
pub fn code(error: u32) -> &'static str {
    match error {
        ERROR_DEVICE_NOT_CONNECTED
        | ERROR_GEN_FAILURE
        | ERROR_FILE_NOT_FOUND
        | ERROR_PATH_NOT_FOUND => "disconnected",
        ERROR_ACCESS_DENIED => "permission_denied",
        ERROR_SHARING_VIOLATION => "busy",
        _ => "io_failed",
    }
}
fn open_code(error: u32, serial: bool) -> &'static str {
    if serial && error == ERROR_ACCESS_DENIED {
        "busy"
    } else {
        code(error)
    }
}
pub fn last() -> &'static str {
    // SAFETY: reading the calling thread's last error only.
    code(unsafe { GetLastError() })
}
pub struct Handle(Option<HANDLE>);
impl Handle {
    pub fn raw(&self) -> HANDLE {
        self.0.expect("closed handle")
    }
    pub fn open(path: &str, metadata: bool, serial: bool) -> Result<Self, &'static str> {
        let access = if metadata {
            0
        } else {
            GENERIC_READ | GENERIC_WRITE
        };
        let share = if serial {
            0
        } else {
            FILE_SHARE_READ | FILE_SHARE_WRITE
        };
        // SAFETY: NUL-terminated path, no inherited handle; OPEN_EXISTING never creates a device.
        let h = unsafe {
            CreateFileW(
                wide(path).as_ptr(),
                access,
                share,
                ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED,
                ptr::null_mut(),
            )
        };
        if h == INVALID_HANDLE_VALUE {
            // SAFETY: read immediately after the failed open.
            let error = unsafe { GetLastError() };
            return Err(open_code(error, serial));
        }
        Ok(Self(Some(h)))
    }
    pub fn close(&mut self) -> Result<(), &'static str> {
        let Some(h) = self.0.take() else {
            return Ok(());
        };
        // SAFETY: all I/O has completed before the owner can close this sole handle.
        if unsafe { CloseHandle(h) } != 0 {
            Ok(())
        } else {
            Err(last())
        }
    }
    pub fn transfer(
        &self,
        bytes: &mut [u8],
        write: bool,
        wait_ms: u32,
    ) -> Result<Option<usize>, &'static str> {
        // SAFETY: manual-reset event, initially nonsignalled; owned by this operation.
        let event = unsafe { CreateEventW(ptr::null(), 1, 0, ptr::null()) };
        if event.is_null() {
            return Err(last());
        }
        let mut event = Handle(Some(event));
        let mut overlapped = OVERLAPPED {
            hEvent: event.raw(),
            ..Default::default()
        };
        let mut n = 0;
        // SAFETY: buffer and OVERLAPPED remain at stable addresses until completion is confirmed
        // below. An unconfirmed cancellation exits without unwinding or dropping either allocation.
        let ok = unsafe {
            if write {
                WriteFile(
                    self.raw(),
                    bytes.as_ptr(),
                    bytes.len() as u32,
                    &mut n,
                    &mut overlapped,
                )
            } else {
                ReadFile(
                    self.raw(),
                    bytes.as_mut_ptr(),
                    bytes.len() as u32,
                    &mut n,
                    &mut overlapped,
                )
            }
        };
        let result = if ok != 0 {
            Ok(Some(n as usize))
        } else {
            // SAFETY: immediate error after ReadFile/WriteFile.
            let error = unsafe { GetLastError() };
            if error != ERROR_IO_PENDING {
                Err(code(error))
            } else {
                complete(
                    &mut Operation {
                        handle: self.raw(),
                        overlapped: &mut overlapped,
                    },
                    wait_ms,
                    if write { 0 } else { 500 },
                )
            }
        };
        let closed = event.close();
        if closed.is_err() {
            std::process::exit(1);
        }
        result
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        if self.close().is_err() {
            std::process::exit(1);
        }
    }
}
struct Operation<'a> {
    handle: HANDLE,
    overlapped: &'a mut OVERLAPPED,
}
impl PendingIo for Operation<'_> {
    fn wait(&mut self, ms: u32) -> Result<(), &'static str> {
        // SAFETY: live event belonging to this outstanding operation.
        match unsafe { WaitForSingleObject(self.overlapped.hEvent, ms) } {
            WAIT_OBJECT_0 | WAIT_TIMEOUT => Ok(()),
            _ => Err(last()),
        }
    }
    fn result(&mut self) -> Completion {
        let mut n = 0;
        // SAFETY: storage and handle remain live; nonblocking completion query.
        if unsafe { GetOverlappedResult(self.handle, self.overlapped, &mut n, 0) } != 0 {
            return Completion::Done(n as usize);
        }
        // SAFETY: immediate thread-local error after completion query.
        match unsafe { GetLastError() } {
            ERROR_IO_INCOMPLETE => Completion::Pending,
            ERROR_OPERATION_ABORTED => Completion::Aborted,
            e => Completion::Failed(code(e)),
        }
    }
    fn cancel(&mut self) {
        // SAFETY: targeted cancellation uses the original operation address; it does not free it.
        // ERROR_NOT_FOUND can mean completion won the race. Always query completion afterwards.
        unsafe { CancelIoEx(self.handle, self.overlapped) };
    }
    fn unconfirmed(&mut self) -> ! {
        std::process::exit(1)
    }
}
// A named mutex holds the per-session endpoint lease across helper processes. Default Windows
// object security belongs to the current token; no file permissions or privileged service needed.
pub struct Lease(Handle);
impl Lease {
    pub fn acquire(name: &str) -> Result<Self, &'static str> {
        // SAFETY: NUL-terminated name, default security, not initially owned by this thread.
        let raw = unsafe {
            CreateMutexW(
                ptr::null(),
                0,
                wide(&format!("Local\\keyloom-device-{name}")).as_ptr(),
            )
        };
        if raw.is_null() {
            return Err(last());
        }
        let handle = Handle(Some(raw));
        // SAFETY: live mutex; zero wait never blocks. An abandoned mutex grants ownership.
        match unsafe { WaitForSingleObject(raw, 0) } {
            WAIT_OBJECT_0 | WAIT_ABANDONED => Ok(Self(handle)),
            WAIT_TIMEOUT => Err("busy"),
            _ => Err(last()),
        }
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        // SAFETY: acquired and released on the same session worker thread, after device close.
        if unsafe { ReleaseMutex(self.0.raw()) } == 0 {
            std::process::exit(1);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removal_errors_and_sharing_are_distinct() {
        assert_eq!(code(ERROR_GEN_FAILURE), "disconnected");
        assert_eq!(code(ERROR_DEVICE_NOT_CONNECTED), "disconnected");
        assert_eq!(code(ERROR_SHARING_VIOLATION), "busy");
        assert_eq!(open_code(ERROR_ACCESS_DENIED, true), "busy");
        assert_eq!(open_code(ERROR_ACCESS_DENIED, false), "permission_denied");
        assert_eq!(std::mem::size_of::<OVERLAPPED>(), 32);
    }
}
