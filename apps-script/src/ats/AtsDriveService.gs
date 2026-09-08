/**
 * Candidate resume storage under HRMS Root / ATS Candidates / {candidate_id}.
 * Reuses DriveService.getRootFolder — does not modify DriveService.
 */
var ATS = ATS || {};

var AtsDriveService = (function () {
  function getOrCreateChild_(parent, name) {
    var it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  }

  function getCandidatesRoot() {
    if (typeof DriveService === 'undefined' || !DriveService.getRootFolder) {
      throw configurationError_('Drive is not available for resume storage.');
    }
    var root = DriveService.getRootFolder();
    return getOrCreateChild_(root, ATS.DRIVE.CANDIDATES_FOLDER);
  }

  function getCandidateFolder(candidateId) {
    var parent = getCandidatesRoot();
    return getOrCreateChild_(parent, String(candidateId));
  }

  function saveResume(candidateId, blob) {
    var folder = getCandidateFolder(candidateId);
    var file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    } catch (ignore) {}
    return {
      drive_file_id: file.getId(),
      drive_folder_id: folder.getId(),
      file_name: file.getName()
    };
  }

  function downloadResume(driveFileId) {
    var file = DriveApp.getFileById(driveFileId);
    var blob = file.getBlob();
    return {
      fileName: blob.getName() || file.getName(),
      mimeType: blob.getContentType() || 'application/octet-stream',
      base64: Utilities.base64Encode(blob.getBytes())
    };
  }

  return {
    getCandidateFolder: getCandidateFolder,
    saveResume: saveResume,
    downloadResume: downloadResume
  };
})();
