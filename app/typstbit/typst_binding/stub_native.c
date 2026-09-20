// Native stubs exposing the flat typst_abi C ABI to MoonBit (typst_binding).
//
// The ABI reads inputs from its own arena (see typst_abi_alloc), so every
// input buffer is copied into the arena before the call, mirroring what the
// wasm host does.
#include "moonbit.h"

#include <stddef.h>
#include <stdint.h>
#include <string.h>

extern uint8_t *typst_abi_alloc(size_t len);
extern uint32_t typst_abi_set_file(size_t path_ptr, size_t path_len, size_t data_ptr, size_t data_len);
extern uint32_t typst_abi_set_main(size_t path_ptr, size_t path_len);
extern uint32_t typst_abi_compile(void);
extern uint32_t typst_abi_page_count(void);
extern const uint32_t *typst_abi_out_len_ptr(void);
extern uint8_t *typst_abi_error_json(void);

static size_t typstbind_len(moonbit_bytes_t bytes) {
  return bytes == NULL ? 0 : (size_t)Moonbit_array_length(bytes);
}

static uint8_t *typstbind_copy_in(const uint8_t *data, size_t len) {
  uint8_t *ptr = typst_abi_alloc(len);
  if (ptr == NULL) {
    return NULL;
  }
  if (len > 0) {
    memcpy(ptr, data, len);
  }
  return ptr;
}

MOONBIT_FFI_EXPORT int64_t typstbind_set_file(moonbit_bytes_t path, moonbit_bytes_t data) {
  size_t path_len = typstbind_len(path);
  size_t data_len = typstbind_len(data);
  uint8_t *path_ptr = typstbind_copy_in(path, path_len);
  uint8_t *data_ptr = typstbind_copy_in(data, data_len);
  if (path_ptr == NULL || (data_ptr == NULL && data_len > 0)) {
    return 1;
  }
  return (int64_t)typst_abi_set_file((size_t)path_ptr, path_len, (size_t)data_ptr, data_len);
}

MOONBIT_FFI_EXPORT int64_t typstbind_set_main(moonbit_bytes_t path) {
  size_t path_len = typstbind_len(path);
  uint8_t *path_ptr = typstbind_copy_in(path, path_len);
  if (path_ptr == NULL) {
    return 1;
  }
  return (int64_t)typst_abi_set_main((size_t)path_ptr, path_len);
}

MOONBIT_FFI_EXPORT int64_t typstbind_compile(void) {
  return (int64_t)typst_abi_compile();
}

MOONBIT_FFI_EXPORT int64_t typstbind_page_count(void) {
  return (int64_t)typst_abi_page_count();
}

MOONBIT_FFI_EXPORT moonbit_bytes_t typstbind_error_json(void) {
  uint8_t *ptr = typst_abi_error_json();
  if (ptr == NULL) {
    return moonbit_make_bytes_raw(0);
  }
  uint32_t len = *typst_abi_out_len_ptr();
  moonbit_bytes_t bytes = moonbit_make_bytes_raw((int32_t)len);
  if (len > 0) {
    memcpy(bytes, ptr, len);
  }
  return bytes;
}
