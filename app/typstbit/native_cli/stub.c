// Native stubs that adapt the flat typst_abi C ABI to MoonBit types.
// Inputs are copied into the ABI arena before each call.
#include "moonbit.h"

#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>

extern uint8_t *typst_abi_alloc(size_t len);
extern uint32_t typst_abi_set_file(size_t path_ptr, size_t path_len, size_t data_ptr, size_t data_len);
extern uint32_t typst_abi_set_package_file(size_t spec_ptr, size_t spec_len, size_t path_ptr, size_t path_len, size_t data_ptr, size_t data_len);
extern uint32_t typst_abi_set_main(size_t path_ptr, size_t path_len);
extern uint32_t typst_abi_compile(void);
extern uint32_t typst_abi_page_count(void);
extern const uint32_t *typst_abi_out_len_ptr(void);
extern uint8_t *typst_abi_error_json(void);
extern uint8_t *typst_abi_export_pdf(void);
extern uint8_t *typst_abi_export_svg(uint32_t page);
extern uint8_t *typst_abi_render_page_png(uint32_t page, uint32_t scale_milli);

static size_t typstbit_len(moonbit_bytes_t bytes) {
  return bytes == NULL ? 0 : (size_t)Moonbit_array_length(bytes);
}

static uint8_t *typstbit_copy_in(const uint8_t *data, size_t len) {
  uint8_t *ptr = typst_abi_alloc(len);
  if (ptr == NULL) {
    return NULL;
  }
  if (len > 0) {
    memcpy(ptr, data, len);
  }
  return ptr;
}

static moonbit_bytes_t typstbit_copy_out(uint8_t *ptr) {
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

MOONBIT_FFI_EXPORT int64_t typstbit_set_file(moonbit_bytes_t path, moonbit_bytes_t data) {
  size_t path_len = typstbit_len(path);
  size_t data_len = typstbit_len(data);
  uint8_t *path_ptr = typstbit_copy_in(path, path_len);
  uint8_t *data_ptr = typstbit_copy_in(data, data_len);
  if (path_ptr == NULL || (data_ptr == NULL && data_len > 0)) {
    return 1;
  }
  return (int64_t)typst_abi_set_file((size_t)path_ptr, path_len, (size_t)data_ptr, data_len);
}

MOONBIT_FFI_EXPORT int64_t typstbit_set_package_file(moonbit_bytes_t spec, moonbit_bytes_t path, moonbit_bytes_t data) {
  size_t spec_len = typstbit_len(spec);
  size_t path_len = typstbit_len(path);
  size_t data_len = typstbit_len(data);
  uint8_t *spec_ptr = typstbit_copy_in(spec, spec_len);
  uint8_t *path_ptr = typstbit_copy_in(path, path_len);
  uint8_t *data_ptr = typstbit_copy_in(data, data_len);
  if (spec_ptr == NULL || path_ptr == NULL || (data_ptr == NULL && data_len > 0)) {
    return 1;
  }
  return (int64_t)typst_abi_set_package_file((size_t)spec_ptr, spec_len, (size_t)path_ptr, path_len, (size_t)data_ptr, data_len);
}

MOONBIT_FFI_EXPORT int64_t typstbit_set_main(moonbit_bytes_t path) {
  size_t path_len = typstbit_len(path);
  uint8_t *path_ptr = typstbit_copy_in(path, path_len);
  if (path_ptr == NULL) {
    return 1;
  }
  return (int64_t)typst_abi_set_main((size_t)path_ptr, path_len);
}

MOONBIT_FFI_EXPORT int64_t typstbit_compile(void) {
  return (int64_t)typst_abi_compile();
}

MOONBIT_FFI_EXPORT int64_t typstbit_page_count(void) {
  return (int64_t)typst_abi_page_count();
}

MOONBIT_FFI_EXPORT moonbit_bytes_t typstbit_error_json(void) {
  return typstbit_copy_out(typst_abi_error_json());
}

MOONBIT_FFI_EXPORT moonbit_bytes_t typstbit_export_pdf(void) {
  return typstbit_copy_out(typst_abi_export_pdf());
}

MOONBIT_FFI_EXPORT moonbit_bytes_t typstbit_export_svg(int64_t page) {
  return typstbit_copy_out(typst_abi_export_svg((uint32_t)page));
}

MOONBIT_FFI_EXPORT moonbit_bytes_t typstbit_render_page_png(int64_t page, int64_t scale_milli) {
  return typstbit_copy_out(typst_abi_render_page_png((uint32_t)page, (uint32_t)scale_milli));
}

MOONBIT_FFI_EXPORT int64_t typstbit_read(int64_t fd, moonbit_bytes_t buf) {
  if (buf == NULL) {
    return -1;
  }
  ssize_t n = read((int)fd, buf, (size_t)Moonbit_array_length(buf));
  return (int64_t)n;
}

MOONBIT_FFI_EXPORT void typstbit_flush_stdout(void) {
  fflush(stdout);
}
