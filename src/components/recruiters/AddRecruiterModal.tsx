'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface AddRecruiterModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId: string;
  companySlug: string;
  companyName: string;
  onSubmit?: (recruiter: RecruiterFormData) => Promise<void>;
}

export interface RecruiterFormData {
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedin_url: string;
  job_id: string;
  company_slug: string;
}

export function AddRecruiterModal({
  isOpen,
  onClose,
  jobId,
  companySlug,
  companyName,
  onSubmit,
}: AddRecruiterModalProps) {
  const [formData, setFormData] = useState<RecruiterFormData>({
    name: '',
    title: '',
    email: '',
    phone: '',
    linkedin_url: '',
    job_id: jobId,
    company_slug: companySlug,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof RecruiterFormData, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof RecruiterFormData, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (formData.email && !isValidEmail(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    if (formData.linkedin_url && !isValidLinkedInUrl(formData.linkedin_url)) {
      newErrors.linkedin_url = 'Invalid LinkedIn URL';
    }

    if (!formData.email && !formData.linkedin_url && !formData.phone.trim()) {
      newErrors.email = 'Provide an email, phone, or LinkedIn URL';
      newErrors.linkedin_url = 'Provide an email, phone, or LinkedIn URL';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isValidEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const isValidLinkedInUrl = (url: string): boolean => {
    return /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/.test(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      if (onSubmit) {
        await onSubmit(formData);
      }
      handleClose();
    } catch (error) {
      console.error('Error adding recruiter:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setFormData({
      name: '',
      title: '',
      email: '',
      phone: '',
      linkedin_url: '',
      job_id: jobId,
      company_slug: companySlug,
    });
    setErrors({});
    onClose();
  };

  const handleChange = (field: keyof RecruiterFormData) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Recruiter Contact">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Share recruiter contact info for <strong className="text-gray-900 dark:text-white">{companyName}</strong> to help
          other job seekers.
        </p>

        <Input
          id="recruiter-name"
          label="Name *"
          placeholder="Jane Smith"
          value={formData.name}
          onChange={handleChange('name')}
          error={errors.name}
        />

        <Input
          id="recruiter-title"
          label="Title"
          placeholder="Technical Recruiter"
          value={formData.title}
          onChange={handleChange('title')}
          error={errors.title}
        />

        <Input
          id="recruiter-email"
          type="email"
          label="Email"
          placeholder="jane.smith@company.com"
          value={formData.email}
          onChange={handleChange('email')}
          error={errors.email}
        />

        <Input
          id="recruiter-phone"
          type="tel"
          label="Phone"
          placeholder="+1 (555) 123-4567"
          value={formData.phone}
          onChange={handleChange('phone')}
          error={errors.phone}
        />

        <Input
          id="recruiter-linkedin"
          label="LinkedIn URL"
          placeholder="https://linkedin.com/in/janesmith"
          value={formData.linkedin_url}
          onChange={handleChange('linkedin_url')}
          error={errors.linkedin_url}
        />

        <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg p-3">
          <p className="text-sm text-yellow-800 dark:text-yellow-300">
            <strong>Note:</strong> Only submit public, professional contact info.
            You can paste a personal email or phone here (e.g. from a ContactOut
            lookup) — the community will verify submissions.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? 'Adding...' : 'Add Recruiter'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
